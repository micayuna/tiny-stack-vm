// tiny-stack-vm: a VM for make.fun's tiny-stack-vm-01 (ISA v1). One run answers
// every instance in /input: runs program.bin on input.bin, writes stdout.bin
// (the exact bytes written) and exit.txt (exit code 0-255) under /output/<id>.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const MAXSTEPS = 1000000;
const MAXOUT = 65536;

// Run one program. Returns [stdoutBytes, exitCode].
function run(prog, input) {
  const n = prog.length;
  const st = new Int32Array(257); // data stack; sp is the count held
  const cs = new Int32Array(64); // call stack; cp is the count held
  const mem = new Int32Array(256);
  const out = []; // output bytes, as numbers 0-255
  const done = (code) => [Buffer.from(out), code];
  const room = (k) => out.length + k <= MAXOUT; // output fits k more bytes
  let pc = 0, sp = 0, cp = 0, ip = 0, steps = 0;
  for (;;) {
    // Step order (ISA "One step"): step limit first, then pc range,
    // then unknown opcode, then immediate fit, then the instruction.
    if (steps === MAXSTEPS) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = prog[pc];
    switch (op) {
      case 0x00: return done(0); // HALT
      case 0x01: if (pc + 2 > n) return done(9); if (sp === 256) return done(3); st[sp++] = (prog[pc + 1] << 24) >> 24; pc += 2; break; // PUSH8, sign-extended
      case 0x02: if (pc + 5 > n) return done(9); if (sp === 256) return done(3); st[sp++] = prog[pc + 1] | (prog[pc + 2] << 8) | (prog[pc + 3] << 16) | (prog[pc + 4] << 24); pc += 5; break; // PUSH32
      case 0x03: if (sp < 1) return done(2); sp--; pc++; break; // POP
      case 0x04: if (sp < 1) return done(2); if (sp === 256) return done(3); st[sp] = st[sp - 1]; sp++; pc++; break; // DUP
      case 0x05: if (sp < 2) return done(2); { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; } pc++; break; // SWAP
      case 0x06: if (sp < 2) return done(2); if (sp === 256) return done(3); st[sp] = st[sp - 2]; sp++; pc++; break; // OVER
      case 0x07: if (sp < 3) return done(2); { const a = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = st[sp - 1]; st[sp - 1] = a; } pc++; break; // ROT
      case 0x10: if (sp < 2) return done(2); st[sp - 2] = (st[sp - 2] + st[sp - 1]) | 0; sp--; pc++; break; // ADD
      case 0x11: if (sp < 2) return done(2); st[sp - 2] = (st[sp - 2] - st[sp - 1]) | 0; sp--; pc++; break; // SUB
      case 0x12: if (sp < 2) return done(2); st[sp - 2] = Math.imul(st[sp - 2], st[sp - 1]); sp--; pc++; break; // MUL
      case 0x13: if (sp < 2) return done(2); if (!st[sp - 1]) return done(4); st[sp - 2] = (st[sp - 2] / st[sp - 1]) | 0; sp--; pc++; break; // DIV
      case 0x14: if (sp < 2) return done(2); if (!st[sp - 1]) return done(4); st[sp - 2] = st[sp - 2] % st[sp - 1]; sp--; pc++; break; // MOD
      case 0x15: if (sp < 2) return done(2); if (!st[sp - 1]) return done(4); st[sp - 2] = ((st[sp - 2] >>> 0) / (st[sp - 1] >>> 0)) | 0; sp--; pc++; break; // DIVU
      case 0x16: if (sp < 2) return done(2); if (!st[sp - 1]) return done(4); st[sp - 2] = ((st[sp - 2] >>> 0) % (st[sp - 1] >>> 0)) | 0; sp--; pc++; break; // MODU
      case 0x17: if (sp < 1) return done(2); st[sp - 1] = (-st[sp - 1]) | 0; pc++; break; // NEG
      case 0x18: if (sp < 2) return done(2); st[sp - 2] = st[sp - 2] & st[sp - 1]; sp--; pc++; break; // AND
      case 0x19: if (sp < 2) return done(2); st[sp - 2] = st[sp - 2] | st[sp - 1]; sp--; pc++; break; // OR
      case 0x1a: if (sp < 2) return done(2); st[sp - 2] = st[sp - 2] ^ st[sp - 1]; sp--; pc++; break; // XOR
      case 0x1b: if (sp < 1) return done(2); st[sp - 1] = ~st[sp - 1]; pc++; break; // NOT
      case 0x1c: if (sp < 2) return done(2); st[sp - 2] = st[sp - 2] << st[sp - 1]; sp--; pc++; break; // SHL
      case 0x1d: if (sp < 2) return done(2); st[sp - 2] = st[sp - 2] >> st[sp - 1]; sp--; pc++; break; // SHR
      case 0x1e: if (sp < 2) return done(2); st[sp - 2] = (st[sp - 2] >>> st[sp - 1]) | 0; sp--; pc++; break; // SHRU
      case 0x20: if (sp < 2) return done(2); st[sp - 2] = st[sp - 2] === st[sp - 1] ? 1 : 0; sp--; pc++; break; // EQ
      case 0x21: if (sp < 2) return done(2); st[sp - 2] = st[sp - 2] < st[sp - 1] ? 1 : 0; sp--; pc++; break; // LT
      case 0x22: if (sp < 2) return done(2); st[sp - 2] = (st[sp - 2] >>> 0) < (st[sp - 1] >>> 0) ? 1 : 0; sp--; pc++; break; // LTU
      case 0x30: if (pc + 3 > n) return done(9); pc += 3 + ((prog[pc + 1] | (prog[pc + 2] << 8)) << 16 >> 16); break; // JMP
      case 0x31: if (pc + 3 > n) return done(9); if (sp < 1) return done(2); { const o = ((prog[pc + 1] | (prog[pc + 2] << 8)) << 16 >> 16); pc = st[--sp] === 0 ? pc + 3 + o : pc + 3; } break; // JZ
      case 0x32: if (pc + 3 > n) return done(9); if (sp < 1) return done(2); { const o = ((prog[pc + 1] | (prog[pc + 2] << 8)) << 16 >> 16); pc = st[--sp] !== 0 ? pc + 3 + o : pc + 3; } break; // JNZ
      case 0x33: if (pc + 3 > n) return done(9); if (cp === 64) return done(7); cs[cp++] = pc + 3; pc = prog[pc + 1] | (prog[pc + 2] << 8); break; // CALL
      case 0x34: if (cp === 0) return done(8); pc = cs[--cp]; break; // RET
      case 0x40: if (sp < 1) return done(2); { const a = st[sp - 1]; if (a < 0 || a > 255) return done(6); st[sp - 1] = mem[a]; } pc++; break; // LOAD
      case 0x41: if (sp < 2) return done(2); { const a = st[--sp]; const v = st[--sp]; if (a < 0 || a > 255) return done(6); mem[a] = v; } pc++; break; // STORE
      case 0x50: { // PRINT: decimal ASCII, no newline
        if (sp < 1) return done(2);
        const s = String(st[--sp]);
        if (!room(s.length)) return done(11);
        for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
        pc++;
        break;
      }
      case 0x51: { // PUTC: one byte, v AND 255
        if (sp < 1) return done(2);
        const v = st[--sp];
        if (!room(1)) return done(11);
        out.push(v & 255);
        pc++;
        break;
      }
      case 0x52: if (sp === 256) return done(3); st[sp++] = ip < input.length ? input[ip++] : -1; pc++; break; // IN
      case 0x53: if (sp < 1) return done(2); return done(st[--sp] & 255); // EXIT
      default: return done(5); // unknown opcode
    }
    steps++;
  }
}

for (const id of readdirSync(IN).sort()) {
  let prog = Buffer.alloc(0);
  let input = Buffer.alloc(0);
  try { prog = readFileSync(join(IN, id, 'program.bin')); } catch {}
  try { input = readFileSync(join(IN, id, 'input.bin')); } catch {}
  const [stdout, code] = run(prog, input);
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'stdout.bin'), stdout);
  writeFileSync(join(OUT, id, 'exit.txt'), String(code) + '\n');
}
