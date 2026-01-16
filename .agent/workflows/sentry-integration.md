---
description: Integrate Sentry for bug reporting in Chrome extension
---

# Sentry Integration Implementation Plan

## Overview
Integrate Sentry into Recordo Chrome extension to enable user-triggered bug reports with automatic context capture (extension version, browser info, project state, console logs).

---

## Phase 1: Sentry Setup & Account Configuration

### 1.1 Create Sentry Account & Project
1. Go to https://sentry.io/signup/
2. Create a free account
3. Create a new project:
   - Platform: **JavaScript - Browser**
   - Project name: "Recordo Chrome Extension"
   - Alert frequency: Choose your preference
4. Copy your **DSN** (Data Source Name) - you'll need this

### 1.2 Install Sentry SDK
```bash
npm install @sentry/react @sentry/browser
```

---

## Phase 2: Core Sentry Integration

### 2.1 Create Sentry Configuration File
**File**: `src/utils/sentry.ts`

```typescript
import * as Sentry from "@sentry/react";

const SENTRY_DSN = "YOUR_DSN_HERE"; // TODO: Replace with actual DSN
const IS_PRODUCTION = import.meta.env.MODE === "production";

export function initSentry(context: "editor" | "popup" | "background" | "content") {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: IS_PRODUCTION ? "production" : "development",
    
    // Only send errors in production, or set to true for testing
    enabled: IS_PRODUCTION,
    
    // Set release version from manifest
    release: `recordo@${chrome.runtime.getManifest().version}`,
    
    // Add context about which part of extension
    initialScope: {
      tags: {
        "extension.context": context,
      },
    },
    
    // Capture 100% of errors, adjust as needed
    tracesSampleRate: IS_PRODUCTION ? 0.1 : 1.0,
    
    // Filter sensitive data
    beforeSend(event) {
      // Remove any potentially sensitive project data
      if (event.extra?.projectState) {
        delete event.extra.projectState.recordingData;
      }
      return event;
    },
  });
}

export function captureBugReport(description: string, additionalContext?: Record<string, any>) {
  Sentry.captureMessage(`User Bug Report: ${description}`, {
    level: "info",
    tags: {
      "report.type": "user-submitted",
    },
    extra: {
      userDescription: description,
      ...additionalContext,
    },
  });
}

export { Sentry };
```

### 2.2 Initialize Sentry in Different Contexts

**Editor** (`src/editor/main.tsx`):
```typescript
import { initSentry } from '../utils/sentry';

// Add at the top of the file, before rendering
initSentry('editor');

// ... rest of your code
```

**Extension Popup** (`src/recording/popup/main.tsx` or similar):
```typescript
import { initSentry } from '../../utils/sentry';

initSentry('popup');

// ... rest of your code
```

**Background Service Worker** (`src/recording/background/background.ts`):
```typescript
import { initSentry } from '../../utils/sentry';

initSentry('background');

// ... rest of your code
```

**Content Script** (`src/recording/content/content.ts`):
```typescript
import { initSentry } from '../../utils/sentry';

initSentry('content');

// ... rest of your code
```

### 2.3 Update Content Security Policy
Update `manifest.json` to allow Sentry's domain:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://*.ingest.sentry.io; object-src 'self'"
}
```

---

## Phase 3: Bug Report UI Component

### 3.1 Create Bug Report Modal Component
**File**: `src/components/ui/BugReportModal.tsx`

```typescript
import { useState } from 'react';
import { MdBugReport, MdClose } from 'react-icons/md';
import { captureBugReport } from '../../utils/sentry';
import { Button } from './Button';

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BugReportModal({ isOpen, onClose }: BugReportModalProps) {
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    setIsSubmitting(true);

    try {
      // Capture additional context
      const context = {
        userAgent: navigator.userAgent,
        extensionVersion: chrome.runtime.getManifest().version,
        timestamp: new Date().toISOString(),
        url: window.location.href,
      };

      captureBugReport(description, context);
      
      setSubmitted(true);
      setTimeout(() => {
        onClose();
        setDescription('');
        setSubmitted(false);
      }, 2000);
    } catch (error) {
      console.error('Failed to submit bug report:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface-raised rounded-lg p-6 w-full max-w-md border border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MdBugReport className="text-primary" size={24} />
            <h2 className="text-lg font-semibold text-text-main">Report a Bug</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-main transition-colors"
          >
            <MdClose size={24} />
          </button>
        </div>

        {submitted ? (
          <div className="py-8 text-center">
            <p className="text-primary font-medium mb-2">Thank you!</p>
            <p className="text-text-secondary text-sm">
              Your bug report has been submitted.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="bug-description" className="block text-sm font-medium text-text-main mb-2">
                What went wrong?
              </label>
              <textarea
                id="bug-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full h-32 px-3 py-2 bg-surface-base border border-border rounded-lg text-text-main placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                placeholder="Please describe the issue you encountered..."
                required
                autoFocus
              />
            </div>

            <div className="text-xs text-text-secondary mb-4">
              We'll automatically include technical details like your browser version and extension version to help us fix the issue.
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                onClick={onClose}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!description.trim() || isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Report'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

### 3.2 Create Bug Report Button Component
**File**: `src/components/ui/BugReportButton.tsx`

```typescript
import { useState } from 'react';
import { MdBugReport } from 'react-icons/md';
import { BugReportModal } from './BugReportModal';

interface BugReportButtonProps {
  variant?: 'icon' | 'text' | 'both';
  className?: string;
}

export function BugReportButton({ variant = 'both', className = '' }: BugReportButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-raised border border-border hover:bg-surface-hover transition-colors text-text-main ${className}`}
        title="Report a bug"
      >
        <MdBugReport size={18} />
        {(variant === 'text' || variant === 'both') && (
          <span className="text-sm">Report Bug</span>
        )}
      </button>

      <BugReportModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
```

---

## Phase 4: Add Bug Report Button to UI

### 4.1 Add to Editor Interface
Add the button to your editor's toolbar or settings area. Example for `src/editor/App.tsx`:

```typescript
import { BugReportButton } from '../components/ui/BugReportButton';

// Add somewhere visible in your UI, e.g., in a settings menu or header
<BugReportButton variant="both" />
```

### 4.2 Add to Extension Popup
Add to `src/recording/popup/Popup.tsx` (or equivalent):

```typescript
import { BugReportButton } from '../../components/ui/BugReportButton';

// Add to your popup UI
<BugReportButton variant="icon" />
```

---

## Phase 5: Environment Variables & Security

### 5.1 Store DSN Securely
**Option A**: Use environment variables (recommended)
1. Create `.env` file:
```
VITE_SENTRY_DSN=your_actual_dsn_here
```

2. Update `.gitignore` to include `.env`

3. Update `src/utils/sentry.ts`:
```typescript
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
```

**Option B**: Hardcode (less secure, but simpler for private extensions)
- Just put the DSN directly in `src/utils/sentry.ts`

---

## Phase 6: Testing & Validation

### 6.1 Test in Development
1. Temporarily set `enabled: true` in Sentry config
2. Build extension: `npm run build:dev`
3. Load extension in Chrome
4. Click "Report Bug" button
5. Submit a test report
6. Check Sentry dashboard to confirm it appears

### 6.2 Test Error Capture
Add a test error somewhere:
```typescript
throw new Error("Test error for Sentry");
```

Verify it appears in Sentry dashboard.

### 6.3 Production Testing
1. Set `enabled: IS_PRODUCTION` back
2. Build production version: `npm run build`
3. Test final build

---

## Phase 7: Advanced Features (Optional)

### 7.1 Add Screenshot Capture
Use `html2canvas` or Chrome's capture API to attach screenshots to bug reports.

### 7.2 Add Project State Snapshot
Capture current editor state (with sensitive data filtered out):

```typescript
// In BugReportModal when submitting
const projectSnapshot = {
  hasProject: !!editorStore.currentProject,
  trackCount: editorStore.tracks?.length,
  // Add other non-sensitive metadata
};

captureBugReport(description, { ...context, projectSnapshot });
```

### 7.3 Add User Identification (Optional)
If you have user accounts:
```typescript
Sentry.setUser({
  id: userId,
  email: userEmail, // Optional
});
```

### 7.4 Add Breadcrumbs
Track user actions before bugs:
```typescript
Sentry.addBreadcrumb({
  category: 'user-action',
  message: 'User clicked export button',
  level: 'info',
});
```

---

## Checklist

- [ ] Create Sentry account and project
- [ ] Install Sentry packages
- [ ] Create `src/utils/sentry.ts` with DSN
- [ ] Initialize Sentry in all contexts (editor, popup, background, content)
- [ ] Update manifest.json CSP
- [ ] Create `BugReportModal.tsx`
- [ ] Create `BugReportButton.tsx`
- [ ] Add bug report button to editor UI
- [ ] Add bug report button to popup UI
- [ ] Test in development mode
- [ ] Configure environment variables (optional)
- [ ] Test in production mode
- [ ] Document for team (how to view bugs in Sentry)

---

## Notes

- **Free tier limit**: 5,000 errors/month (should be plenty)
- **Data retention**: 90 days on free tier
- **Team access**: Can invite team members to view bugs
- **Notifications**: Configure email/Slack alerts in Sentry dashboard
- **Releases**: Consider tagging releases in Sentry to track which version has bugs
