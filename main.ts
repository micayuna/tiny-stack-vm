// tiny-stack-vm: a tiny stack virtual machine for make.fun's tiny-stack-vm-01.
// ISA v1 (see kit program/generator/subject/ISA.md): 32-bit wrapping integers,
// a 256-value data stack, a 64-deep call stack, 256 words of memory, byte
// input/output, ten traps, a 1,000,000-step limit and a 65,536-byte output cap.
//
// One run answers every instance in /input (or MAKEFUN_INPUT_DIR): for each
// <id> it runs /input/<id>/program.bin on /input/<id>/input.bin and writes
// /output/<id>/stdout.bin (the exact bytes the program wrote) and
// /output/<id>/exit.txt (its exit code, 0-255).
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
  let pc = 0, sp = 0, cp = 0, ip = 0, steps = 0;
  for (;;) {
    // Step order (ISA "One step"): step limit first, then pc range,
    // then unknown opcode, then immediate fit, then the instruction.
    if (steps === MAXSTEPS) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = prog[pc];
    switch (op) {
      case 0x00: return done(0); // HALT
      case 0x01: { // PUSH8: 1-byte immediate, sign-extended
        if (pc + 2 > n) return done(9);
        if (sp === 256) return done(3);
        const v = prog[pc + 1];
        st[sp++] = v < 128 ? v : v - 256;
        pc += 2;
        break;
      }
      case 0x02: { // PUSH32: 4-byte little-endian immediate
        if (pc + 5 > n) return done(9);
        if (sp === 256) return done(3);
        st[sp++] = prog[pc + 1] | (prog[pc + 2] << 8) | (prog[pc + 3] << 16) | (prog[pc + 4] << 24);
        pc += 5;
        break;
      }
      case 0x03: // POP
        if (sp < 1) return done(2);
        sp--;
        pc++;
        break;
      case 0x04: // DUP
        if (sp < 1) return done(2);
        if (sp === 256) return done(3);
        st[sp] = st[sp - 1];
        sp++;
        pc++;
        break;
      case 0x05: { // SWAP
        if (sp < 2) return done(2);
        const t = st[sp - 1];
        st[sp - 1] = st[sp - 2];
        st[sp - 2] = t;
        pc++;
        break;
      }
      case 0x06: // OVER
        if (sp < 2) return done(2);
        if (sp === 256) return done(3);
        st[sp] = st[sp - 2];
        sp++;
        pc++;
        break;
      case 0x07: { // ROT: (a b c -- b c a)
        if (sp < 3) return done(2);
        const a = st[sp - 3];
        st[sp - 3] = st[sp - 2];
        st[sp - 2] = st[sp - 1];
        st[sp - 1] = a;
        pc++;
        break;
      }
      case 0x10: { // ADD, wraps
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = (st[sp - 1] + b) | 0;
        pc++;
        break;
      }
      case 0x11: { // SUB, wraps
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = (st[sp - 1] - b) | 0;
        pc++;
        break;
      }
      case 0x12: { // MUL, low 32 bits of the exact product
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = Math.imul(st[sp - 1], b);
        pc++;
        break;
      }
      case 0x13: { // DIV, signed, truncated toward zero
        if (sp < 2) return done(2);
        const b = st[--sp];
        const a = st[sp - 1];
        if (b === 0) return done(4);
        st[sp - 1] = (a / b) | 0; // -2147483648 / -1 wraps to -2147483648
        pc++;
        break;
      }
      case 0x14: { // MOD, signed remainder, sign of a
        if (sp < 2) return done(2);
        const b = st[--sp];
        const a = st[sp - 1];
        if (b === 0) return done(4);
        st[sp - 1] = a % b; // x % -1 is 0, as in JS
        pc++;
        break;
      }
      case 0x15: { // DIVU, unsigned quotient read back as signed
        if (sp < 2) return done(2);
        const b = st[--sp];
        const a = st[sp - 1];
        if (b === 0) return done(4);
        st[sp - 1] = ((a >>> 0) / (b >>> 0)) | 0;
        pc++;
        break;
      }
      case 0x16: { // MODU, unsigned remainder read back as signed
        if (sp < 2) return done(2);
        const b = st[--sp];
        const a = st[sp - 1];
        if (b === 0) return done(4);
        st[sp - 1] = ((a >>> 0) % (b >>> 0)) | 0;
        pc++;
        break;
      }
      case 0x17: // NEG, wraps
        if (sp < 1) return done(2);
        st[sp - 1] = (-st[sp - 1]) | 0;
        pc++;
        break;
      case 0x18: { // AND
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = st[sp - 1] & b;
        pc++;
        break;
      }
      case 0x19: { // OR
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = st[sp - 1] | b;
        pc++;
        break;
      }
      case 0x1a: { // XOR
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = st[sp - 1] ^ b;
        pc++;
        break;
      }
      case 0x1b: // NOT
        if (sp < 1) return done(2);
        st[sp - 1] = ~st[sp - 1];
        pc++;
        break;
      case 0x1c: { // SHL: only the low 5 bits of the count matter
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = st[sp - 1] << b;
        pc++;
        break;
      }
      case 0x1d: { // SHR: arithmetic, sign bit copied in
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = st[sp - 1] >> b;
        pc++;
        break;
      }
      case 0x1e: { // SHRU: logical, zeros in, read back as signed
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = (st[sp - 1] >>> b) | 0;
        pc++;
        break;
      }
      case 0x20: { // EQ
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = st[sp - 1] === b ? 1 : 0;
        pc++;
        break;
      }
      case 0x21: { // LT, signed
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = st[sp - 1] < b ? 1 : 0;
        pc++;
        break;
      }
      case 0x22: { // LTU, unsigned
        if (sp < 2) return done(2);
        const b = st[--sp];
        st[sp - 1] = (st[sp - 1] >>> 0) < (b >>> 0) ? 1 : 0;
        pc++;
        break;
      }
      case 0x30: { // JMP: pc = (next instruction) + signed offset
        if (pc + 3 > n) return done(9);
        const off = (prog[pc + 1] | (prog[pc + 2] << 8)) << 16 >> 16;
        pc = pc + 3 + off;
        break;
      }
      case 0x31: { // JZ: jump as JMP if v = 0
        if (pc + 3 > n) return done(9);
        if (sp < 1) return done(2);
        const off = (prog[pc + 1] | (prog[pc + 2] << 8)) << 16 >> 16;
        const v = st[--sp];
        pc = v === 0 ? pc + 3 + off : pc + 3;
        break;
      }
      case 0x32: { // JNZ: jump as JMP if v is not 0
        if (pc + 3 > n) return done(9);
        if (sp < 1) return done(2);
        const off = (prog[pc + 1] | (prog[pc + 2] << 8)) << 16 >> 16;
        const v = st[--sp];
        pc = v !== 0 ? pc + 3 + off : pc + 3;
        break;
      }
      case 0x33: { // CALL: 2-byte unsigned target, push next address
        if (pc + 3 > n) return done(9);
        if (cp === 64) return done(7);
        cs[cp++] = pc + 3;
        pc = prog[pc + 1] | (prog[pc + 2] << 8);
        break;
      }
      case 0x34: // RET
        if (cp === 0) return done(8);
        pc = cs[--cp];
        break;
      case 0x40: { // LOAD
        if (sp < 1) return done(2);
        const addr = st[sp - 1];
        if (addr < 0 || addr > 255) return done(6);
        st[sp - 1] = mem[addr];
        pc++;
        break;
      }
      case 0x41: { // STORE: (v addr --)
        if (sp < 2) return done(2);
        const addr = st[--sp];
        const v = st[--sp];
        if (addr < 0 || addr > 255) return done(6);
        mem[addr] = v;
        pc++;
        break;
      }
      case 0x50: { // PRINT: decimal ASCII, no newline
        if (sp < 1) return done(2);
        const s = String(st[--sp]);
        if (out.length + s.length > MAXOUT) return done(11);
        for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
        pc++;
        break;
      }
      case 0x51: { // PUTC: one byte, v AND 255
        if (sp < 1) return done(2);
        const v = st[--sp];
        if (out.length + 1 > MAXOUT) return done(11);
        out.push(v & 255);
        pc++;
        break;
      }
      case 0x52: // IN: next input byte, or -1 once used up
        if (sp === 256) return done(3);
        st[sp++] = ip < input.length ? input[ip++] : -1;
        pc++;
        break;
      case 0x53: { // EXIT: code v AND 255
        if (sp < 1) return done(2);
        return done(st[--sp] & 255);
      }
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
