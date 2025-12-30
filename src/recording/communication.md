# Recording Communication Flow

Message flow between extension contexts during recording lifecycle.

## Architecture Overview

```mermaid
graph TB
    subgraph "Extension Popup"
        Popup["App.tsx"]
    end
    
    subgraph "Service Worker"
        BG["background.ts"]
    end
    
    subgraph "Recording Context"
        OS["offscreen.ts (Tab Mode)"]
        CT["controller.ts (Window/Desktop)"]
    end
    
    subgraph "Recorded Page"
        CS["content.ts"]
        ER["eventRecorder"]
    end
    
    Popup -->|START_SESSION| BG
    BG -->|START_COUNTDOWN| CS
    CS -->|COUNTDOWN_DONE| BG
    BG -->|START_RECORDING_VIDEO| OS
    BG -->|START_RECORDING_VIDEO| CT
    BG -->|START_RECORDING_EVENTS| CS
    CS -->|CAPTURE_USER_EVENT| BG
    BG -->|CAPTURE_USER_EVENT| OS
    BG -->|CAPTURE_USER_EVENT| CT
    Popup -->|STOP_SESSION| BG
    BG -->|STOP_RECORDING_VIDEO| OS
    BG -->|STOP_RECORDING_VIDEO| CT
    BG -->|STOP_RECORDING_EVENTS| CS
```

---

## Message Sequence (Tab Mode)

```mermaid
sequenceDiagram
    participant P as Popup
    participant B as Background
    participant O as Offscreen
    participant C as Content

    P->>B: START_SESSION (mode: tab)
    B->>B: Create offscreen document
    B->>O: PING_OFFSCREEN
    O-->>B: PONG
    B->>C: START_COUNTDOWN
    C->>C: Show 3-2-1 overlay
    C-->>B: COUNTDOWN_DONE (dimensions)
    B->>O: START_RECORDING_VIDEO (config)
    B->>C: START_RECORDING_EVENTS (startTime)
    
    loop Recording
        C->>B: CAPTURE_USER_EVENT
        B->>O: CAPTURE_USER_EVENT
    end

    P->>B: STOP_SESSION
    B->>O: STOP_RECORDING_VIDEO
    O->>O: Save to ProjectStorage
    B->>C: STOP_RECORDING_EVENTS
    B->>B: Open editor tab
```

---

## Message Sequence (Window/Desktop Mode)

```mermaid
sequenceDiagram
    participant P as Popup
    participant B as Background
    participant CT as Controller
    participant C as Content

    P->>B: START_SESSION (mode: window|desktop)
    B->>B: Open controller tab
    B->>B: chooseDesktopMedia picker
    B->>CT: PING_CONTROLLER
    CT-->>B: PONG
    B->>CT: START_RECORDING_VIDEO (sourceId)
    
    loop Recording
        C->>B: CAPTURE_USER_EVENT
        B->>CT: CAPTURE_USER_EVENT
    end

    P->>B: STOP_SESSION
    B->>CT: STOP_RECORDING_VIDEO
    CT->>CT: Save to ProjectStorage
    B->>C: STOP_RECORDING_EVENTS (broadcast)
    B->>B: Close controller, open editor
```

---

## Message Types Reference

| Message | Direction | Purpose |
|---------|-----------|---------|
| `START_SESSION` | Popup → Background | Initiate recording |
| `STOP_SESSION` | Popup → Background | End recording |
| `START_COUNTDOWN` | Background → Content | Begin 3-2-1 countdown |
| `COUNTDOWN_DONE` | Content → Background | Report viewport dimensions |
| `START_RECORDING_VIDEO` | Background → Offscreen/Controller | Start MediaRecorder |
| `STOP_RECORDING_VIDEO` | Background → Offscreen/Controller | Stop and save video |
| `START_RECORDING_EVENTS` | Background → Content | Start EventRecorder |
| `STOP_RECORDING_EVENTS` | Background → Content | Stop event capture |
| `CAPTURE_USER_EVENT` | Content → Background → Recorder | Forward user event |
| `PING_OFFSCREEN` | Background → Offscreen | Health check |
| `PING_CONTROLLER` | Background → Controller | Health check |
| `GET_RECORDING_STATE` | Any → Background | Query current state |
