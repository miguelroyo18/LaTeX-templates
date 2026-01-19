# File: Makefile

TEX = pdflatex
BIB = biber
SUBFILES = *.tex *.bib
TEMP = *.aux *.log *.toc *.out *.ilg *.ind *.bbl *.blg *.idx *.run.xml *.bcf *.log

FILE = lab-report

compile: $(FILE).tex $(SUBFILES)
	$(TEX) $(FILE).tex
	$(BIB) $(FILE)
	$(TEX) $(FILE).tex
	rm -rf ${TEMP}

check:
	for file in $(FILE).tex $(SUBFILES); do \
		aspell -t -c --lang=es_ES $$file; \
	done

clean:
	rm -rf ${TEMP}

.PHONY: compile clean
