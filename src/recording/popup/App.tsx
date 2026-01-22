import { useState, useEffect } from 'react';
import { MSG_TYPES, STORAGE_KEYS } from '../../recording/shared/messageTypes';
import { RecordingConfig } from './components/RecordingConfig';
import { RecordingStatus } from './components/RecordingStatus';
import { Button } from '../../components/ui';
import { MdBugReport } from 'react-icons/md';
import { FiEyeOff } from 'react-icons/fi';
import { BugReportModal } from '../../components/ui/BugReportModal';
import permissionGuide from '../../assets/permission-guide.jpg';
import logoFull from '../../assets/fulllogo.png';

type PermissionState = 'unknown' | 'granted' | 'denied' | 'prompt';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<number>(0);
  const [recordingMode, setRecordingMode] = useState<'tab' | 'window' | 'screen'>('tab');

  // Device Lists
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);

  // Toggles and Selections
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState("");

  // Streams & Permissions
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [audioPermission, setAudioPermission] = useState<PermissionState>('unknown');
  const [videoPermission, setVideoPermission] = useState<PermissionState>('unknown');
  const [canInjectContentScript, setCanInjectContentScript] = useState<boolean | null>(null);
  const [isBugReportModalOpen, setIsBugReportModalOpen] = useState(false);

  // Live timer for recording duration
  const [recordingDuration, setRecordingDuration] = useState<number>(0);

  // Update recording duration every second
  useEffect(() => {
    if (!isRecording || !recordingStartTime) {
      setRecordingDuration(0);
      return;
    }

    // Set initial duration immediately to avoid showing 00:00
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    setRecordingDuration(elapsed);

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      setRecordingDuration(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording, recordingStartTime]);

  useEffect(() => {
    // 1. Initial State from Storage
    chrome.storage.session.get(STORAGE_KEYS.RECORDING_STATE).then((result) => {
      const state = result[STORAGE_KEYS.RECORDING_STATE];
      if (state && (state as any).isRecording) {
        setIsRecording(true);
        setRecordingStartTime((state as any).startTime || 0);
      }
    });

    // 2. Listen for external changes (Background updating storage)
    const storageListener = (changes: any, areaName: string) => {
      if (areaName === 'session' && changes[STORAGE_KEYS.RECORDING_STATE]) {
        const newState = changes[STORAGE_KEYS.RECORDING_STATE].newValue;
        setIsRecording(newState?.isRecording || false);
        setRecordingStartTime(newState?.startTime || 0);
      }
    };
    chrome.storage.onChanged.addListener(storageListener);

    // 3. Fallback: Query Background
    chrome.runtime.sendMessage({
      type: MSG_TYPES.GET_RECORDING_STATE,
      payload: {}
    }, (response: any) => {
      if (response && response.isRecording) {
        setIsRecording(true);
        setRecordingStartTime(response.startTime || 0);
      }
    });

    // 4. Disable blur mode when popup opens
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: MSG_TYPES.DISABLE_BLUR_MODE }).catch(() => {
          // Ignore errors if content script is not loaded
        });
      }
    });

    // Populate devices on load
    navigator.mediaDevices.enumerateDevices().then(devices => {
      setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
      setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
    });

    return () => {
      chrome.storage.onChanged.removeListener(storageListener);
      // Clean up streams on unmount
      stopStream(audioStream);
      stopStream(videoStream);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const checkInjection = async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab?.id) return;

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => { }
        });
        setCanInjectContentScript(true);
      } catch (e) {
        setCanInjectContentScript(false);
      }
    };
    checkInjection();
  }, []);

  const stopStream = (stream: MediaStream | null) => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
  };

  const refreshDevices = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audios = devices.filter(d => d.kind === 'audioinput');
    const videos = devices.filter(d => d.kind === 'videoinput');
    setAudioDevices(audios);
    setVideoDevices(videos);

    // Auto-select first if none selected
    if (!selectedAudioId && audios.length > 0) setSelectedAudioId(audios[0].deviceId);
    if (!selectedVideoId && videos.length > 0) setSelectedVideoId(videos[0].deviceId);
  };

  const handleAudioToggle = async (enabled: boolean) => {
    setIsAudioEnabled(enabled);
    if (enabled) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true
        });
        setAudioStream(stream);
        setAudioPermission('granted');
        await refreshDevices();
      } catch (err) {
        console.error("Audio permission failed:", err);
        setAudioPermission('denied');
        setAudioStream(null);
      }
    } else {
      stopStream(audioStream);
      setAudioStream(null);
      setAudioPermission('unknown');
    }
  };

  const handleVideoToggle = async (enabled: boolean) => {
    setIsVideoEnabled(enabled);
    if (enabled) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: selectedVideoId ? { deviceId: { exact: selectedVideoId } } : true
        });
        setVideoStream(stream);
        setVideoPermission('granted');
        await refreshDevices();
      } catch (err) {
        console.error("Video permission failed:", err);
        setVideoPermission('denied');
        setVideoStream(null);
      }
    } else {
      stopStream(videoStream);
      setVideoStream(null);
      setVideoPermission('unknown');
    }
  };

  // Switch device while enabled
  useEffect(() => {
    if (isAudioEnabled && selectedAudioId && audioPermission === 'granted') {
      // Restart stream with new device
      // Note: This logic might need debouncing or careful handling to avoid rapid switches
      // For now, simpler to just re-trigger toggle logic or extract stream acquisition
      const switchAudio = async () => {
        stopStream(audioStream);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selectedAudioId } } });
          setAudioStream(stream);
        } catch (e) {
          console.error("Failed to switch audio", e);
        }
      }
      switchAudio();
    }
  }, [selectedAudioId]);

  // Switch video device while enabled
  useEffect(() => {
    if (isVideoEnabled && selectedVideoId && videoPermission === 'granted') {
      const switchVideo = async () => {
        stopStream(videoStream);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: selectedVideoId } } });
          setVideoStream(stream);
        } catch (e) {
          console.error("Failed to switch video", e);
        }
      }
      switchVideo();
    }
  }, [selectedVideoId]);


  const startRecording = async () => {
    if (isAudioEnabled && audioPermission !== 'granted') return;
    if (isVideoEnabled && videoPermission !== 'granted') return;

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) return;

      chrome.runtime.sendMessage({
        type: MSG_TYPES.START_SESSION,
        tabId: tab.id,
        payload: {
          tabId: tab.id,
          mode: recordingMode,
          hasAudio: isAudioEnabled,
          hasCamera: isVideoEnabled,
          audioDeviceId: selectedAudioId,
          videoDeviceId: selectedVideoId
        }
      }, (response: any) => {
        if (response?.success) {
          setIsRecording(true);
          window.close();
        } else {
          console.error("Failed to start recording", response?.error);
        }
      });
    } catch (error) {
      console.error("Error starting recording:", error);
    }
  };

  const stopRecording = () => {
    chrome.runtime.sendMessage({
      type: MSG_TYPES.STOP_SESSION,
      payload: {}
    }, (response: any) => {
      if (response?.success) {
        setIsRecording(false);
      }
    });
  };

  const hasPermissionError = (isAudioEnabled && audioPermission === 'denied') || (isVideoEnabled && videoPermission === 'denied');

  const openOptions = () => {
    chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=chrome-extension://${chrome.runtime.id}` });
  };

  const handleBlurMode = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) return;

      chrome.tabs.sendMessage(tab.id, {
        type: MSG_TYPES.ENABLE_BLUR_MODE
      });
      window.close();
    } catch (error) {
      console.error("Failed to enable blur mode:", error);
    }
  };

  if (hasPermissionError) {
    return (
      <div className="w-[320px] bg-surface text-text-highlighted font-sans overflow-hidden flex flex-col p-4">
        <h2 className="text-xl font-bold mb-4 text-destructive">Permission Denied</h2>
        <p className="text-sm text-text-main mb-4">
          Please allow access to your microphone and camera to use Recordio.
        </p>

        <div className="mb-4 rounded-lg overflow-hidden border border-border">
          <img src={permissionGuide} alt="Permission Guide" className="w-full h-auto" />
        </div>

        <Button
          onClick={openOptions}
          className="w-full py-2 text-sm"
        >
          Open Settings
        </Button>

        <p className="text-xs text-text-muted mt-4 text-center">
          After enabling, please close and reopen this popup.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-[320px] bg-surface text-text-highlighted font-sans overflow-hidden flex flex-col">
      {/* Fixed Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <a
          href="https://recordio.site"
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-70 hover:opacity-100 transition-opacity duration-200"
        >
          <img src={logoFull} alt="Recordio" className="h-6" />
        </a>
        <div className="flex items-center gap-1">
          <Button
            onClick={handleBlurMode}
            className="p-1.5"
            title={
              recordingMode !== 'tab'
                ? "Blur mode only available in Tab mode"
                : canInjectContentScript === false
                  ? "Cannot blur Chrome-owned pages"
                  : "Blur Items"
            }
            disabled={recordingMode !== 'tab' || canInjectContentScript === false}
          >
            <FiEyeOff size={16} />
          </Button>
          <Button
            onClick={() => setIsBugReportModalOpen(true)}
            title="Report Bug"
          >
            <MdBugReport size={16} />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-4 flex flex-col">
        {!isRecording ? (
          <RecordingConfig
            recordingMode={recordingMode}
            setRecordingMode={setRecordingMode}
            audioDevices={audioDevices}
            videoDevices={videoDevices}
            isAudioEnabled={isAudioEnabled}
            isVideoEnabled={isVideoEnabled}
            selectedAudioId={selectedAudioId}
            selectedVideoId={selectedVideoId}
            audioStream={audioStream}
            videoStream={videoStream}
            canInjectContentScript={canInjectContentScript}
            hasPermissionError={hasPermissionError}
            handleAudioToggle={handleAudioToggle}
            handleVideoToggle={handleVideoToggle}
            setSelectedAudioId={setSelectedAudioId}
            setSelectedVideoId={setSelectedVideoId}
            startRecording={startRecording}
          />
        ) : (
          <RecordingStatus
            recordingDuration={recordingDuration}
            stopRecording={stopRecording}
          />
        )}
      </div>
      <BugReportModal
        isOpen={isBugReportModalOpen}
        onClose={() => setIsBugReportModalOpen(false)}
      />
    </div>
  );
}

export default App;
