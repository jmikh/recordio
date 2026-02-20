import { FaGift } from 'react-icons/fa';
import { XButton, Modal } from '@shared/components';
import type { ExportQuality } from '../../export/ExportManager';

interface FreeExportConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    selectedQuality: ExportQuality;
}

export function FreeExportConfirmModal({ isOpen, onClose, onConfirm, selectedQuality }: FreeExportConfirmModalProps) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[460px]">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <FaGift className="text-primary" size={22} />
                    <h2 className="text-xl font-semibold text-text-highlighted">
                        Free Export Credit
                    </h2>
                </div>
                <XButton onClick={onClose} title="Close" />
            </div>

            <div className="mb-6 bg-primary/10 border border-primary/30 rounded-sm p-4">
                <p className="text-sm text-text-highlighted mb-2">
                    You have <strong>1 free HD/4K export</strong> without watermark!
                </p>
                <p className="text-xs text-text-muted">
                    This will use your free credit to export in <strong className="text-text-highlighted">{selectedQuality}</strong>.
                    After this, 1080p+ and 60fps exports are only available with a Pro subscription.
                </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
                <button onClick={onClose} className="interactive-base flex items-center justify-center gap-2 flex-1">
                    Cancel
                </button>
                <button onClick={onConfirm} className="interactive-primary flex items-center justify-center gap-2 flex-1 py-2">
                    <FaGift className="mr-2" size={14} />
                    Export Now — Free
                </button>
            </div>
        </Modal>
    );
}

