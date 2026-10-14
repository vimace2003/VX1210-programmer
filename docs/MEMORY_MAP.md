# VX-1210 memory map / `.C42` file format

A `.C42` file is a byte-for-byte dump of CE42's `TText` object (data at `+4`), **17 927 bytes**.
CE42 refuses any other size. Offsets below are file/image offsets.
Implementation: [`layout.ts`](../packages/core/src/layout.ts), [`channel.ts`](../packages/core/src/channel.ts),
[`settings.ts`](../packages/core/src/settings.ts), [`selcall.ts`](../packages/core/src/selcall.ts), [`tuner.ts`](../packages/core/src/tuner.ts).

Fields are described in CE42 by 8-byte descriptors `(startByte | startBit<<16, endByte | endBit<<16)`
(table at `0x4D9608`): big-endian bit ranges, `startBit` is the MSB in the first byte, the value is
shifted right by `endBit`. Values of list settings are indices into the tables at `0x4D8578`
(`TVALTBLX`, 0x58 bytes each). Dialog combo boxes are refilled from those tables at run time, so
the item lists stored in the DFM resources are only design-time placeholders.

## Overview

| Offset | Size | Contents |
|---|---|---|
| `0x0000` | 6 | model id `"ac027h"` |
| `0x0006` | 500 × 32 | channel records (block *n* = channel *n*+1) |
| `0x3E86` | 384 | general settings (blocks 500–511) |
| `0x4004` | 2 | marker `A5 69` (always rewritten) |
| `0x4006` | 512 | antenna tuner bank 0 (channels 1–250, 2 bytes each) |
| `0x4206` | 512 | antenna tuner bank 1 (channels 251–500) |
| `0x4406` | 512 | factory block (serial, alignment, temperature correction, options) |
| `0x4604` | 2 | marker `A5 69` |
| `0x4606` | 1 | PC-side Selcall flag (probably the Selcall menu state, `FUN_004d3874`), not sent to the radio |

## Channel record (32 bytes)

| Byte | Field | Values |
|---|---|---|
| 0 | status | `A5` programmed, `FF` empty (anything else → empty) |
| 1 | mode | 0 LSB (J3E), 1 USB (J3E), 2 CW (A1A), 3 AM (A3E), 4 DATA (J2B — RTTY/PKT and sideband per System → Data mode). CE42 shows the ITU designators |
| 2–5 | RX frequency | uint32 BE, 10 Hz units (`000493E0` = 3.00000 MHz) |
| 6–9 | TX frequency | uint32 BE, 10 Hz units |
| 10–17 | tag | 8 ASCII chars, `00` padded, upper case |
| 18 | power | 0 High, 1 Low |
| 19 | — | unused, preserved |
| 20 | selcall | 0 OFF, 1 ON |
| 21 | encryption | 0 OFF, 1 ON |
| 22 | encryption code | 0–15 (shown 01–16) |
| 23 | tune mode | 0 OFF, 1 ON |
| 24 | clock shift | 0 OFF, 1 ON |
| 25 | TX inhibit | 0 TX allowed, otherwise RX only |
| 26–31 | — | `FF`, preserved |

Grid editor rules (`FUN_0049892c`): max 30 MHz; RX min 0.5 MHz (3 MHz with the *3-30 MHz* RX range
option); TX min 1.6 MHz; 10 Hz resolution. A new empty channel is `FF 01 000493E0 000493E0 "  CH-nnn"`
followed by 8 × `00` and 6 × `FF`.

## General settings (image offsets)

| Offset | Setting | Values | CE42 dialog |
|---|---|---|---|
| `3E86` | — | unused by the dialogs, preserved | |
| `3E87–3E8A` | Selcall Self ID | 4 digits (byte 0–9) | Selcall Common |
| `3E8B–3EB2` | TX ID 1–10 | 10 × 4 digits | Selcall Common |
| `3EB3` | Telcall format | BARRETT, CODAN12, CODAN16 | Telephone Number |
| `3EB4–3F53` | telephone numbers | 10 × 16 digits (`20` = blank) | Telephone Number |
| `3F54` | Kill System | OFF, ON | Selcall Common |
| `3F55–3F5C` | Kill System ID | 8 digits | Selcall Common |
| `3F5D` | VOX gain | OFF, 1–100 | Miscellaneous |
| `3F5E` | VOX delay | 500–2500 ms (5 steps) | Miscellaneous |
| `3F5F` | CW delay | 500–2500 ms | A1A Function |
| `3F60` | tuner unit | OFF, ON | Option |
| `3F61` | encryption unit | OFF, ON | Option |
| `3F62` | Selcall unit | OFF, ON | Option / Selcall |
| `3F63` | TOT | OFF, 0.5–10 min | System |
| `3F64` | Selcall power save | OFF, 1–9 s | Selcall Common |
| `3F65` | preamble | 1.0–10.0 s (0.5 s steps) | Selcall Common |
| `3F66` | Selcall hold time | 0.5–10 min | Selcall Common |
| `3F67` | Sub Group Call | ENABLE, DISABLE | Selcall Common |
| `3F68` | Group Call | ENABLE, DISABLE | Selcall Common |
| `3F69` | All Call | ENABLE, DISABLE | Selcall Common |
| `3F6A` | beep | OFF, ON | Miscellaneous |
| `3F6B` | noise blanker | OFF, ON | System |
| `3F6C` | battery saver: save time | OFF, 1.0–5.0 s | Power Saving |
| `3F6D` | battery saver: hold time | 5–30 s (0.5 s steps) | Power Saving |
| `3F6E` | speaker | Internal, Auto, SP MIC | System |
| `3F6F` | lamp | On, Off, Toggle, Moment, 3 s, Auto | Hardware |
| `3F70` | HAIL | 1, 2, 3 | Hardware |

## Factory block (user-editable options)

Written only through the read-back-and-patch sequence described in [PROTOCOL.md](PROTOCOL.md).

| Offset | Setting | Values |
|---|---|---|
| `4406–440D` | serial number | 8 bytes, displayed e.g. `0B000000` (byte 1 is a letter code) |
| `440E–4441` | alignment (power, carrier offsets…) | service only |
| `4442–45CD` | temperature correction table | service only |
| `45CE` | CW pitch | 400–1000 Hz (7 steps) |
| `45CF` | data mode | RTTY-LSB, RTTY-USB, PKT-LSB, PKT-USB |
| `45D0` | RTTY shift | 170, 425, 850 Hz |
| `45D1` | RTTY frequency display | Mark, Carrier |
| `45D2–45D3` | PKT frequency offset | int16 BE × 10 Hz, −3000…+3000 Hz (default −212 → −2120 Hz) |
| `45D4` | PKT tone | 1170, 1700, 2125, 2210 Hz |
| `45D5` | TX range | 1.6-30 MHz, 3-30 MHz (factory) |
| `45D6` | RX range | 0.5-30 MHz, 3-30 MHz (factory) |
| `45D7–45D9` | keys A, B, C | 0 N/A, 1 SELCALL, 2 Power Select, 3 Noise Blanker, 4 Antenna Tuner, 5 Antenna Tuning, 6 ENCRYPTION, 7 Display Select, 8 HAIL, 9 TELCALL, 10 Squelch, 11 Speaker Select, 12 Lamp, 13 VFO/Memory |
| `45DA` | alignment | service only |

## Antenna tuner (2 bytes per channel)

`byte0: b7 Reset · b6 Thru · b5-4 Trans · b3-2 Mid-C · b1 Top-C · b0 + byte1 = L (9 bits)`.
