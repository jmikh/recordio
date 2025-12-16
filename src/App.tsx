import { useState, useEffect } from 'react';

interface RecordingStateResponse {
  isRecording?: boolean;
  success?: boolean;
  error?: string;
}

function App() {
  const [isRecording, setIsRecording] = useState(false);

  // Device Lists
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);

  // Toggles and Selections
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [selectedVideoId, setSelectedVideoId] = useState("");

  useEffect(() => {
    // Check initial recording state
    chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, (response: RecordingStateResponse) => {
      if (response && response.isRecording) {
        setIsRecording(true);
      }
    });

    // Populate devices on load (might have empty labels if no perm yet)
    // We don't force permissions here, only when user toggles.
    navigator.mediaDevices.enumerateDevices().then(devices => {
      setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
      setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
    });
  }, []);

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

  const handleToggle = async (type: 'audio' | 'video', enabled: boolean) => {
    if (type === 'audio') setIsAudioEnabled(enabled);
    else setIsVideoEnabled(enabled);

    if (enabled) {
      // Check if we have labels. If not, request permission.
      // Or just always request permission when enabling to be safe and get fresh labels.
      await requestPermissionsForKey(type === 'audio', type === 'video');
      await refreshDevices();
    }
  };

  const requestPermissionsForKey = async (checkAudio: boolean, checkVideo: boolean) => {
    try {
      const checkPermission = async () => {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Permission request timed out")), 1500)
        );

        const request = navigator.mediaDevices.getUserMedia({
          audio: checkAudio,
          video: checkVideo
        });

        return Promise.race([request, timeout]);
      };

      const stream = await checkPermission() as MediaStream;
      stream.getTracks().forEach(t => t.stop());
    } catch (err) {
      console.log("Opening permission helper due to:", err);
      const width = 500;
      const height = 450;
      await chrome.windows.create({
        url: chrome.runtime.getURL(`src/permissions/permissions.html?audio=${checkAudio}&video=${checkVideo}`),
        type: 'popup',
        width,
        height,
        focused: true
      });
    }
  };

  const startRecording = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) return;

      chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        tabId: tab.id,
        hasAudio: isAudioEnabled,
        hasCamera: isVideoEnabled,
        audioDeviceId: selectedAudioId,
        videoDeviceId: selectedVideoId
      }, (response: RecordingStateResponse) => {
        if (response?.success) {
          setIsRecording(true);
        } else {
          console.error("Failed to start recording", response?.error);
        }
      });
    } catch (error) {
      console.error("Error starting recording:", error);
    }
  };

  const stopRecording = () => {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response: RecordingStateResponse) => {
      if (response?.success) {
        setIsRecording(false);
      }
    });
  };

  return (
    <div className="w-[300px] bg-slate-900 text-white font-sans overflow-hidden flex flex-col">
      <div className="p-4 flex flex-col items-center justify-center min-h-[400px]">
        <h1 className="text-2xl font-bold mb-8 bg-gradient-to-r from-purple-400 to-pink-600 bg-clip-text text-transparent">
          Recordo
        </h1>

        {!isRecording ? (
          <div className="flex flex-col items-center w-full gap-6">

            {/* Audio Controls */}
            <div className="w-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-300">Microphone</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={isAudioEnabled} onChange={(e) => handleToggle('audio', e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>
              {isAudioEnabled && (
                <select
                  value={selectedAudioId}
                  onChange={(e) => setSelectedAudioId(e.target.value)}
                  className="w-full bg-slate-800 text-xs border border-slate-700 rounded p-2 text-slate-300 outline-none focus:border-purple-500"
                >
                  {audioDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 4)}...`}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Video Controls */}
            <div className="w-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-300">Camera</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={isVideoEnabled} onChange={(e) => handleToggle('video', e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-pink-600"></div>
                </label>
              </div>
              {isVideoEnabled && (
                <select
                  value={selectedVideoId}
                  onChange={(e) => setSelectedVideoId(e.target.value)}
                  className="w-full bg-slate-800 text-xs border border-slate-700 rounded p-2 text-slate-300 outline-none focus:border-pink-500"
                >
                  {videoDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 4)}...`}</option>
                  ))}
                </select>
              )}
            </div>

            <button
              onClick={startRecording}
              className="mt-4 group relative w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 transition-all duration-300 flex items-center justify-center shadow-lg hover:shadow-red-500/50"
            >
              <div className="w-6 h-6 bg-white rounded-full group-hover:scale-110 transition-transform" />
            </button>
          </div>
        ) : (
          <button
            onClick={stopRecording}
            className="group relative w-24 h-24 rounded-full bg-slate-800 border-2 border-red-500 hover:bg-red-900/20 transition-all duration-300 flex items-center justify-center shadow-lg hover:shadow-red-500/20"
          >
            <div className="w-8 h-8 bg-red-500 rounded sm group-hover:scale-90 transition-transform" />
          </button>
        )}

        <p className="mt-8 text-slate-400 font-medium text-sm">
          {isRecording ? 'Recording is active' : 'Ready to capture'}
        </p>
      </div>
    </div>
  );
}

export default App;
