import { useState, useEffect } from 'react';
import { MSG_TYPES, STORAGE_KEYS } from '../../recording/shared/messageTypes';
import { AudioVisualizerWrapper } from './components/AudioVisualizerWrapper';
import { CameraPreview } from './components/CameraPreview';
import { MultiToggle, Toggle, Dropdown, Button, PrimaryButton, Notice } from '../../components/ui';
import { MdBugReport } from 'react-icons/md';
import { FiEyeOff } from 'react-icons/fi';
import { BugReportModal } from '../../components/ui/BugReportModal';
import permissionGuide from '../../assets/permission-guide.jpg';
import logoFull from '../../assets/logo-full-source.png';

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
    if (!isRecording || !recordingStartTime) return;

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
        <img src={logoFull} alt="Recordio" className="h-6" />
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
            className="p-1.5"
            title="Report Bug"
          >
            <MdBugReport size={16} />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-4 flex flex-col">
        {!isRecording ? (
          <div className="flex flex-col w-full gap-5">

            {/* Mode Selection */}
            {/* Mode Selection */}
            <div className="w-full">
              <MultiToggle
                options={[
                  { value: 'tab', label: 'Tab' },
                  { value: 'window', label: 'Window' },
                  { value: 'screen', label: 'Screen' }
                ]}
                value={recordingMode}
                onChange={(mode) => {
                  setRecordingMode(mode);
                  // If leaving tab mode, disable blur
                  if (mode !== 'tab') {
                    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
                      if (tabs[0]?.id) {
                        chrome.tabs.sendMessage(tabs[0].id, { type: MSG_TYPES.DISABLE_BLUR_MODE });
                      }
                    });
                  }
                }}
                className="w-full text-xs"
              />
            </div>

            {recordingMode === 'tab' && canInjectContentScript === false && (
              <Notice variant="warning" className="animate-in fade-in slide-in-from-top-1">
                Cannot record tab of Chrome own pages. Start Recordio in another tab or use Window or Screen mode instead.
              </Notice>
            )}

            {/* Audio Controls */}
            <div className="w-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-text-highlighted flex items-center gap-2">
                  Microphone
                </span>
                <Toggle value={isAudioEnabled} onChange={handleAudioToggle} />
              </div>
              {isAudioEnabled && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                  <Dropdown
                    options={audioDevices.map(d => ({
                      value: d.deviceId,
                      label: d.label || `Microphone ${d.deviceId.slice(0, 4)}...`,
                      icon: (
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" x2="12" y1="19" y2="22" />
                        </svg>
                      )
                    }))}
                    value={selectedAudioId}
                    onChange={setSelectedAudioId}
                    trigger={
                      <div className="w-full bg-surface-overlay text-xs border border-border rounded p-2 text-text-highlighted cursor-pointer hover:border-border-hover transition-colors flex items-center justify-between">
                        <span>{audioDevices.find(d => d.deviceId === selectedAudioId)?.label || `Microphone ${selectedAudioId.slice(0, 4)}...`}</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                    }
                  />
                  <AudioVisualizerWrapper stream={audioStream} />
                </div>
              )}
            </div>

            {/* Video Controls */}
            <div className="w-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-text-highlighted">Camera</span>
                <Toggle value={isVideoEnabled} onChange={handleVideoToggle} />
              </div>
              {isVideoEnabled && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                  <Dropdown
                    options={videoDevices.map(d => ({
                      value: d.deviceId,
                      label: d.label || `Camera ${d.deviceId.slice(0, 4)}...`,
                      icon: (
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m22 8-6 4 6 4V8Z" />
                          <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
                        </svg>
                      )
                    }))}
                    value={selectedVideoId}
                    onChange={setSelectedVideoId}
                    trigger={
                      <div className="w-full bg-surface-overlay text-xs border border-border rounded p-2 text-text-highlighted cursor-pointer hover:border-border-hover transition-colors flex items-center justify-between">
                        <span>{videoDevices.find(d => d.deviceId === selectedVideoId)?.label || `Camera ${selectedVideoId.slice(0, 4)}...`}</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                    }
                  />
                  <CameraPreview stream={videoStream} />
                </div>
              )}
            </div>



            <PrimaryButton
              onClick={startRecording}
              disabled={hasPermissionError || (recordingMode === 'tab' && canInjectContentScript === false)}
              className="mt-4 w-full"
            >
              Start Recording
            </PrimaryButton>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 py-6">
            {/* Recording Status */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
                <span className="text-sm text-text-highlighted font-medium">Recording</span>
              </div>

              {/* Live Timer */}
              <div className="text-3xl font-bold text-text-highlighted tabular-nums">
                {Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:
                {(recordingDuration % 60).toString().padStart(2, '0')}
              </div>
            </div>

            {/* Finish Recording Button */}
            <PrimaryButton
              onClick={stopRecording}
              className="w-full py-2.5"
            >
              Finish Recording
            </PrimaryButton>
          </div>
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
