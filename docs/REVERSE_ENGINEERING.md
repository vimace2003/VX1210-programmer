# How CE42 was reverse engineered

Target: `CE42Win.exe` from `ce42_setup_ver1_08_vx-1210a` (Vertex Standard, 2007-era).
SHA-256 `34e9cde1dcbff71f0de1070b7466899fe888cb9127e042a5c57c1068434d0064`.

The goal was interoperability: a compatible, maintainable replacement. No original code was copied;
the clone re-implements the observed formats and behaviour. The two sample files shipped with the
installer (`default.c42`, `Alignment.C42`) are used as test fixtures.

## Toolchain (all portable, in `VX1210/tools`)

- **REA 6.4** (`rea-agents`) — MCP/CLI for evidence-based binary analysis, Ghidra provider
- **Ghidra 12.1.4** + Temurin JDK 21 — headless import, decompilation (`borlanddelphi` compiler spec)
- Node 24 — REA runtime and helper scripts
- Small Java/Node helpers written for this project (`VX1210/re`, `scratchpad/tools`):
  InstallShield 14 cabinet extractor, Delphi resource/DFM decoder, Delphi VMT/RTTI scanner,
  DATA-section reader, descriptor/dialog cross-referencer

## Steps

1. **Unpack the installer.** InstallShield 14 cabinets (`data1.hdr`, `data1.cab`, `data2.cab`) were
   extracted with a Java port of unshield's format logic; all MD5s verified. Payload:
   `CE42Win.exe`, two `.chm` help files, `default.c42`, `Alignment.C42`, `msflxgrd.ocx`.
2. **Identify the compiler.** Section names `CODE/DATA/BSS/.idata/.tls/.rdata/.reloc/.rsrc`,
   Borland strings and VCL classes → Delphi ≤ 2007.
3. **Forms.** 26 binary DFM resources (`TPF0`) were converted to text: complete UI, control names,
   event handler names. Help files were decompiled with `hh.exe -decompile`.
4. **RTTI.** Scanning for VMTs (`vmtSelfPtr` at −76) recovered 316 classes, 345 published methods
   with addresses (e.g. `TfrmRadio.FormShow = 0x4ADF38`) and 934 overridden virtual methods
   (e.g. `TCommTransThread.Execute = 0x47EF78`), plus field tables (form control offsets).
5. **Decompilation.** REA's Windows Ghidra provider is read-only and Ghidra's auto-analysis does not
   discover Delphi event handlers (they are only referenced from RTTI). A headless Ghidra script
   (`re/ghidra_scripts/DelphiSeedDecompile.java`) seeded and named the 1 279 RTTI entry points,
   re-ran analysis with the Delphi calling convention and decompiled the application units.
   REA was used for overview, assembly-level checks (`procedure_assembly`) and cross-checking.
6. **Protocol.** `TfrmRadio` (`FUN_004ae28c`, `FUN_004ae5e4`, `FUN_004aef80`, `FUN_004af76c`) and the
   `TCommX` component gave the serial settings, frame layout and sequencing. The 37-byte command
   constants were read from DATA and verified (each ends with its own checksum).
7. **Memory map.** The decoder `FUN_00494b78` and encoder `FUN_00493440` are table driven:
   field descriptors at `0x4D9608..0x4D9918`, per-channel descriptors at `0x4D9920`, tuner at
   `0x4D99B8`. Each descriptor was bound to a dialog control by matching the setter called from
   the decoder with the setter called from the dialog's OK handler; value lists came from the
   `TVALTBLX` tables the dialogs load in `FormCreate`.
8. **Validation.** The clone generates a new image that is byte-identical to `default.c42`,
   round-trips both sample files byte for byte, and passes an end-to-end transfer against a
   behavioural simulator of the radio.

## What still needs hardware

See *Open points* in [PROTOCOL.md](PROTOCOL.md). Recommended first test with a real radio:
read the radio, save the `.C42`, open it in the original CE42 (or compare with a CE42 upload of
the same radio). Only then write.
