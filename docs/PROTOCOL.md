# VX-1210 clone protocol

Recovered from `CE42Win.exe` 1.08 (Borland Delphi, image base `0x400000`) with REA + Ghidra 12.1.4.
Addresses refer to that binary. Implementation: [`packages/core/src/protocol`](../packages/core/src/protocol).

## Physical link

| Item | Value | Source |
|---|---|---|
| Cable | SVC-1200, PC COM port ↔ radio MIC jack | help `Get Started` |
| Line | 9600 baud, 8 data bits, no parity, **2 stop bits** | `FUN_004ae1fc`, DFM `CommX.StopBit = csb2` |
| Flow control | none | `FUN_0047e828(5)` → DCB flags `0x1010` |
| Modem lines | **DTR on, RTS on** (likely powers the cable interface) | DCB `fDtrControl = fRtsControl = ENABLE` |
| Echo | none — CE42 would fail its own identification check otherwise | `FUN_004b0088` |
| Timeouts | 1000 ms per answer | timer at `TfrmMain+0x520` |

CE42 opens the port, waits ~200 ms, and re-opens the port for every phase of a transfer.
Each byte is written with its own `WriteFile` call; there is no inter-byte delay.

## Frames

PC → radio commands are always **37 bytes**:

```
[0] 0x00 (0x01 for the serial query)
[1] command
[2] parameter hi
[3] parameter lo
[4..35] 32 data bytes (zero when unused)
[36] checksum = (sum of bytes 0..35) & 0xFF
```

| Command | Bytes (non-zero) | Meaning | DATA address |
|---|---|---|---|
| identify | `[2]=10 [36]=10` | identification request | `0x4D83F4` |
| read | `[1]=01 [36]=01` | start upload (radio → PC) | `0x4D841C` |
| write begin | `[1]=02 [3]=mask` | start download, `mask` selects regions | `0x4D8444/846C/8494` |
| write block | `[1]=03 [2..3]=address [4..35]=data` | store 32 bytes at radio address | built in `FUN_004aef80` |
| write end | `[1]=04 [3]=kind` | finish (`02` normal, `01` service) | `0x4D84C0/8510` |
| serial query | `[0]=01 [1]=09` | radio answers 8 bytes (Serial Writer dialog) | `0x4D84E8` |

Write masks: `0xC6` normal (channels `0x80` + general `0x40` + tuner banks `0x04|0x02`),
`0x08` factory/alignment block, `0x06` antenna tuner banks only.

Radio answers to write commands with one byte: `'Y'` (`0x59`) accepted, `'N'` (`0x4E`) refused.

### Identification answer (16 bytes)

```
[0] firmware hi   [1] firmware lo     → shown as "%2.2x%2.2x", e.g. "0108"
[2..7] "ac027h"                       → model id, must match
[8..15] not used by CE42
```

Up to 3 attempts, 10 ms apart (`FUN_004ae28c`).

## Upload (radio → PC) — `FUN_004ae5e4`

1. identify
2. send **read**
3. receive channel records of **35 bytes** `[channel hi][channel lo][32 data][sum of bytes 0..33]`,
   answer `'Y'` to each; records with channel < 500 are stored at block `channel`; the loop ends
   with the first record whose channel number is ≥ 500 (also acknowledged, not stored)
4. receive **60 blocks of 33 bytes** `[32 data][sum of bytes 0..31]`, `'Y'` after each:
   12 general (blocks 500–511), 16 tuner bank 0, 16 tuner bank 1, 16 factory (blocks 512–559)
5. close the port; normalise the data (sanitiser `FUN_00496d1c`)

Errors reported by CE42: `Upload error` (no/late answer), `Checksum error`,
`Clone Data Error: incompatible data` (decoder rejected the image).

## Download (PC → radio) — `TfrmMain.miDownloadClick`

CE42 never sends its own copy of the factory/alignment block. The full sequence is:

1. **Normal write** (`FUN_004aef80`, mask `0xC6`): identify → write begin → `'Y'` →
   one write-block per *programmed* channel (status `0xA5`) at `0xC000 + 32·n` →
   12 general blocks at `0xFE80` → 16 at `0x0400` → 16 at `0x0800` → write end `02` → wait 2 s.
   Each block must be answered with `'Y'`.
2. **Read back** the whole radio (upload above).
3. **Factory options**: copy only the user-editable bytes that live in the factory block
   (CW pitch, data mode, RTTY shift/display, PKT offset/tone, RX/TX range, keys A/B/C) onto the
   factory block just read from the radio, then write it (`FUN_004af76c`, mask `0x08`, 16 blocks
   at `0x0C00`, write end `01`).

Empty channels are not transmitted, so the radio must clear its channel area when the write
mask includes channels — the simulator models it that way (not verified on hardware).

## Radio address map

| Radio address | Image offset | Size | Contents |
|---|---|---|---|
| `0xC000–0xFE7F` | `0x0006` | 500 × 32 | channels |
| `0xFE80–0xFFFF` | `0x3E86` | 12 × 32 | general settings |
| `0x0400–0x05FF` | `0x4006` | 16 × 32 | antenna tuner, channels 1–250 |
| `0x0800–0x09FF` | `0x4206` | 16 × 32 | antenna tuner, channels 251–500 |
| `0x0C00–0x0DFF` | `0x4406` | 16 × 32 | factory: serial, alignment, temperature correction, options |

## Open points (need a real radio)

- whether the radio sends all 500 channel records or only programmed ones on upload (CE42 handles both);
- contents of identification bytes 8–15;
- exact value of the terminating channel record;
- whether the channel area is erased by the `0xC6` write request.

The service functions (alignment, temperature correction, tuner-only write, serial writer and
firmware update `AC027???_V????.SFL`) use the same frames; only alignment/tuner writes are
modelled here and they are not exposed in the UI.
