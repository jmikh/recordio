import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';

function PermissionRequest() {
    const [status, setStatus] = useState("Requesting permissions...");

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const audio = params.get('audio') === 'true';
        const video = params.get('video') === 'true';

        if (!audio && !video) {
            setStatus("No permissions requested.");
            return;
        }

        navigator.mediaDevices.getUserMedia({ audio, video })
            .then((stream) => {
                setStatus("Permissions Granted! You can close this tab and start recording.");
                stream.getTracks().forEach(t => t.stop());
                setTimeout(() => {
                    window.close();
                }, 2000);
            })
            .catch((err) => {
                console.error(err);
                setStatus(`Error: ${err.message}. Please allow permissions in your browser settings.`);
            });
    }, []);

    return (
        <div className="text-center p-8 bg-slate-800 rounded-lg shadow-xl max-w-md">
            <h1 className="text-2xl font-bold mb-4">Recordo Permissions</h1>
            <p className="text-lg mb-4">{status}</p>
            <p className="text-sm text-slate-400">This tab is needed to authorize microphone and camera access for the extension.</p>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <PermissionRequest />
    </React.StrictMode>
);
