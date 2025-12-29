import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

const Marker = ({ top, left, bottom, right }: { top?: number | string, left?: number | string, bottom?: number | string, right?: number | string }) => (
    <div style={{
        position: 'fixed',
        top, left, bottom, right,
        width: '50px',
        height: '50px',
        backgroundColor: '#FF0000',
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
    }}>
        <div style={{
            width: '20px',
            height: '20px',
            backgroundColor: '#0000FF'
        }} />
    </div>
);

const CalibrationApp = () => {
    const [status, setStatus] = useState("Calibrating Viewport...");
    const [found, setFound] = useState(false);

    useEffect(() => {
        // Report dimensions to background
        const width = Math.round(window.innerWidth * window.devicePixelRatio);
        const height = Math.round(window.innerHeight * window.devicePixelRatio);
        chrome.runtime.sendMessage({
            type: 'CALIBRATION_DIMENSIONS',
            payload: { dimensions: { width, height } }
        });

        const listener = (message: any) => {
            if (message.type === 'CALIBRATION_COMPLETE') {
                setFound(true);
                setStatus("Found them! Viewport Calibrated.");
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    return (
        <div style={{
            width: '100vw',
            height: '100vh',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'column'
        }}>
            {/* 4 Corner Markers */}
            <Marker top={0} left={0} />
            <Marker top={0} right={0} />
            <Marker bottom={0} left={0} />
            <Marker bottom={0} right={0} />

            <h1>{status}</h1>
            {!found && <p>Please select this window in the picker.</p>}
            {found && <p style={{ color: '#4CAF50', fontSize: '2em' }}>✓</p>}
        </div>
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <CalibrationApp />
    </React.StrictMode>,
);
