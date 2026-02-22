.PHONY: install test run

# Ensure current directory is in PATH for any scripts we call
export PATH := $(CURDIR):$(PATH)

install:
	@python3 -c "import requests" || (echo "requests is not installed. Please install it using your package manager." && exit 1)
	@echo "Dependencies are already satisfied or handled manually."

test:
	python3 -m unittest discover .

run:
	python3 weather_fetcher.py
