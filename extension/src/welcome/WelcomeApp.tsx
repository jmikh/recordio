import { useState, useEffect } from 'react';
import { Button } from '@shared/components';
import { BiMicrophone, BiMicrophoneOff } from 'react-icons/bi';
import { PiWebcamBold, PiWebcamSlashBold } from 'react-icons/pi';
import { MdCheckCircle } from 'react-icons/md';
import logoIcon from '@shared/assets/logo.svg';
import pinImage from '../assets/extension-pin.png';
import recordStartImage from '../assets/record-start.png';

type PermissionState = 'prompt' | 'granted' | 'denied';

async function queryPermission(name: PermissionName): Promise<PermissionState> {
    try {
        const result = await navigator.permissions.query({ name });
        return result.state as PermissionState;
    } catch {
        return 'prompt';
    }
}

export function WelcomeApp() {
    const [micState, setMicState] = useState<PermissionState>('prompt');
    const [camState, setCamState] = useState<PermissionState>('prompt');
    const [requestingMic, setRequestingMic] = useState(false);
    const [requestingCam, setRequestingCam] = useState(false);

    useEffect(() => {
        queryPermission('microphone').then(setMicState);
        queryPermission('camera').then(setCamState);
    }, []);

    const requestMic = async () => {
        setRequestingMic(true);
        try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            s.getTracks().forEach(t => t.stop());
            setMicState('granted');
        } catch {
            setMicState('denied');
        } finally {
            setRequestingMic(false);
        }
    };

    const requestCam = async () => {
        setRequestingCam(true);
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: true });
            s.getTracks().forEach(t => t.stop());
            setCamState('granted');
        } catch {
            setCamState('denied');
        } finally {
            setRequestingCam(false);
        }
    };

    return (
        <div className="min-h-screen bg-surface-body flex flex-col items-center justify-center px-8 py-16">
            <div className="w-full max-w-5xl flex flex-col items-center gap-12">

                {/* Logo + heading */}
                <div className="flex flex-col items-center gap-4">
                    <h1 className="text-3xl font-semibold text-text-highlighted flex items-center gap-3">
                        <img src={logoIcon} alt="Recordio" className="h-8 w-8" />
                        Welcome to Recordio
                    </h1>
                    <p className="text-base text-text-muted max-w-md">
                        Beautiful screen recordings in three simple steps.
                    </p>
                </div>

                {/* Steps */}
                <div className="grid grid-cols-3 gap-6 w-full">

                    {/* Step 1 — Permissions */}
                    <StepCard number={1} title="Allow Permissions" description="Grant microphone and camera access so Recordio can include them in your recordings." bare>
                        <div className="flex flex-col gap-2 w-full">
                            <PermissionRow
                                label="Microphone"
                                state={micState}
                                requesting={requestingMic}
                                icon={micState === 'granted' ? <BiMicrophone className="icon-lg" /> : <BiMicrophoneOff className="icon-lg" />}
                                onRequest={requestMic}
                            />
                            <PermissionRow
                                label="Camera"
                                state={camState}
                                requesting={requestingCam}
                                icon={camState === 'granted' ? <PiWebcamBold className="icon-lg" /> : <PiWebcamSlashBold className="icon-lg" />}
                                onRequest={requestCam}
                            />
                        </div>
                    </StepCard>

                    {/* Step 2 — Pin */}
                    <StepCard number={2} title="Pin Recordio" description="Click the puzzle piece in your toolbar and pin Recordio for quick access anytime.">
                        <img src={pinImage} alt="Pin Recordio" className="w-full h-auto rounded-md border border-border block" />
                    </StepCard>

                    {/* Step 3 — Record */}
                    <StepCard number={3} title="Start Recording" description="Click the Recordio icon and hit Start Recording. Click the icon again to finish.">
                        <img src={recordStartImage} alt="Start Recording" className="w-full h-auto rounded-md border border-border block" />
                    </StepCard>

                </div>

                <p className="text-xs text-text-muted">
                    Click the Recordio icon in your toolbar to get started.
                </p>
            </div>
        </div>
    );
}

function StepCard({ number, title, description, bare = false, children }: {
    number: number;
    title: string;
    description: string;
    bare?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-4 bg-surface rounded-lg border border-border p-5">
            <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-semibold text-primary">{number}</span>
                </div>
                <span className="text-sm font-semibold text-text-highlighted">{title}</span>
            </div>
            {bare ? children : (
                <div className="w-full">
                    {children}
                </div>
            )}
            <span className="text-xs text-text-muted leading-relaxed">{description}</span>
        </div>
    );
}

function PermissionRow({ label, state, requesting, icon, onRequest }: {
    label: string;
    state: PermissionState;
    requesting: boolean;
    icon: React.ReactNode;
    onRequest: () => void;
}) {
    return (
        <div className="flex items-center gap-2 px-3 h-12 rounded-md border border-border bg-surface-raised">
            <span className={state === 'granted' ? 'text-primary' : 'text-text-muted'}>
                {icon}
            </span>
            <span className="text-xs font-medium text-text-main flex-1">{label}</span>
            {state === 'granted' ? (
                <span className="flex items-center gap-1 text-xs text-success font-medium">
                    <MdCheckCircle className="icon-sm" />
                    Allowed
                </span>
            ) : state === 'denied' ? (
                <span className="text-xs text-destructive font-medium">Denied</span>
            ) : (
                <Button variant="base" onClick={onRequest} disabled={requesting}>
                    {requesting ? 'Requesting…' : 'Allow'}
                </Button>
            )}
        </div>
    );
}
