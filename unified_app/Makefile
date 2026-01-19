.PHONY: all help check-and-run setup-venv install run clean info quickstart check-model

.DEFAULT_GOAL := all

PY := python
VENV := venv
ACT := . $(VENV)/Scripts/activate

all: check-and-run

help:
	@echo "make setup-venv   # Tạo venv và cài deps"
	@echo "make install      # Cài deps (yêu cầu venv đã có)"
	@echo "make run          # Chạy app (FastAPI + PyQt6) CPU-only"
	@echo "make check-model  # Kiểm tra model ONNX tồn tại"
	@echo "make clean        # Xóa __pycache__"
	@echo "make info         # Thông tin Python/pip"
	@echo "make quickstart   # setup-venv + run"

check-and-run: check-model
	@if [ ! -d "$(VENV)" ]; then \
		echo "Creating venv..."; \
		$(MAKE) setup-venv; \
	fi
	@$(MAKE) run

setup-venv:
	@$(PY) -m venv $(VENV)
	@bash -c "$(ACT) && $(PY) -m pip install --upgrade pip && $(PY) -m pip install -r requirements.txt"

install:
	@if [ ! -d "$(VENV)" ]; then \
		echo "venv not found. Run 'make setup-venv' first."; \
		exit 1; \
	fi
	@bash -c "$(ACT) && $(PY) -m pip install -r requirements.txt"

run:
	@if [ ! -d "$(VENV)" ]; then \
		echo "venv not found. Run 'make setup-venv' first."; \
		exit 1; \
	fi
	@bash -c "$(ACT) && $(PY) app.py"

check-model:
	@if [ ! -f "models/license_plate.onnx" ]; then \
		echo "Model not found: models/license_plate.onnx"; \
		echo "Place license_plate.onnx in unified_app/models/"; \
		exit 1; \
	fi
	@echo "Model OK: models/license_plate.onnx"

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	find . -type f -name "*.pyo" -delete 2>/dev/null || true

info:
	@$(PY) --version
	@pip --version

quickstart: setup-venv run

