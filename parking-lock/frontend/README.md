# Parking Lock Management System - Frontend

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Setup environment
```bash
cp .env.example .env
# Edit .env if backend is not running on localhost:3000
```

### 3. Run development server
```bash
npm run dev
```

Frontend will start on: http://localhost:5173

### 4. Build for production
```bash
npm run build
```

The build output will be in `dist/` folder.

## UI Framework

This project uses **Bootstrap 5** for UI components and layout.

### Icons
We use **Bootstrap Icons** for all icons in the application.

Examples:
- Device status: `bi-hdd-network`, `bi-hdd-network-fill`
- Locker status: `bi-lock`, `bi-unlock`
- Actions: `bi-play-fill`, `bi-pause-fill`

See all icons at: https://icons.getbootstrap.com/

## Features

- Real-time dashboard with device and locker statistics
- Locker management with remote control
- Device monitoring and configuration
- Command and status logs
- Full-screen status board for TV display
