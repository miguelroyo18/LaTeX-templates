## About

A collection of LaTeX templates and shared style files I use for university
reports, notes, and standalone figures.

### Shared style files

Reusable `.sty` packages meant to be imported from other documents (e.g. via
`\usepackage{../common/file-config}`):

- **`file-config.sty`** — page geometry, `fancyhdr` header/footer setup,
  paragraph formatting, table naming, and an `mdframed` code-block style.
- **`colours.sty`** — custom colour palettes (Autumn Sunset Glow, Alacena)
  defined with `xcolor`.
- **`listings-config.sty`** — a `listings` style with syntax-highlighting
  colours and full support for accented/special characters in source code.
- **`math-definitions.sty`** — common math macros (`\N`, `\Z`, `\R`, `\C`,
  `\Aut`, `\Ker`, etc.) and Spanish-language theorem environments
  (Teorema, Proposición, Lema, Corolario, Observación, Definición, Ejemplo).

### Document templates

- **`lab-report.tex`** — a full lab-report/practice template (in Spanish)
  built on the shared style files above, with a title page, table of
  contents, algorithm and code listings (via `algorithm`/`algpseudocode` and
  `listings`), a bibliography (`biblatex` + `biber`, see `references.bib`),
  and a work-hours breakdown table.
- **`timetable.tex`** — a colour-coded weekly class timetable built with
  `nicematrix`.

### Standalone TikZ figures

Small, hardcoded `standalone` diagrams (not generic/reusable, just quick
figures for specific documents):

- **`memory_address_decomposition.tex`** — a 32-bit memory address split into
  tag/set/word/byte fields.
- **`minimax_tree.tex`** — a minimax game tree with MAX/MIN layers.
- **`stack.tex`** — a call-stack frame diagram with stack pointer and frame
  pointer annotations.

### Build

A `Makefile` is included for compiling `lab-report.tex`:

```sh
make compile   # pdflatex -> biber -> pdflatex, then clean auxiliary files
make check     # spell-check all .tex/.bib files with aspell (es_ES)
make clean     # remove auxiliary/build files
```
