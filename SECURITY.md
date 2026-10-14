# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting:
<https://github.com/vimace2003/VX1210-programmer/security/advisories/new>, or e-mail
<contato@pp5kj.com>.

You can expect an answer within a week. Relevant areas include the Electron shell
(`apps/desktop/main.cjs`: custom protocol, permissions, navigation), parsing of `.C42` and CSV files,
and anything that could make the program write unintended data to a radio.
