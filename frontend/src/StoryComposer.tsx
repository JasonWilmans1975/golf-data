import { useEffect, useRef, useState, type ChangeEvent } from "react";

export const BACKGROUND_PRESETS = [
    { id: "g1", css: "linear-gradient(135deg, #667eea, #764ba2)" },
    { id: "g2", css: "linear-gradient(135deg, #f093fb, #f5576c)" },
    { id: "g3", css: "linear-gradient(135deg, #4facfe, #00f2fe)" },
    { id: "g4", css: "linear-gradient(135deg, #43e97b, #38f9d7)" },
    { id: "g5", css: "linear-gradient(135deg, #fa709a, #fee140)" },
    { id: "g6", css: "linear-gradient(135deg, #30cfd0, #330867)" },
];

export function backgroundCss(id: string | null): string {
    return BACKGROUND_PRESETS.find((preset) => preset.id === id)?.css ?? BACKGROUND_PRESETS[0].css;
}

export function StoryComposer({
    onClose,
    onShare,
    uploading,
}: {
    onClose: () => void;
    onShare: (input: { file: File | null; caption: string; backgroundColor: string | null }) => void;
    uploading: boolean;
}) {
    const [step, setStep] = useState<"choose" | "photo" | "text">("choose");
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [caption, setCaption] = useState("");
    const [background, setBackground] = useState(BACKGROUND_PRESETS[0].id);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!file) {
            setPreviewUrl(null);
            return;
        }

        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
        const selected = event.target.files?.[0];
        event.target.value = "";
        if (selected) {
            setFile(selected);
            setStep("photo");
        }
    }

    function handleShare() {
        if (step === "photo" && file) {
            onShare({ file, caption, backgroundColor: null });
        } else if (step === "text" && caption.trim()) {
            onShare({ file: null, caption, backgroundColor: background });
        }
    }

    const canShare =
        !uploading && ((step === "photo" && Boolean(file)) || (step === "text" && caption.trim().length > 0));

    return (
        <div className="modal-overlay story-composer-overlay" onClick={onClose}>
            <div className="modal-card story-composer-card" onClick={(event) => event.stopPropagation()}>
                <div className="post-composer-topbar">
                    <button
                        type="button"
                        className="post-composer-cancel"
                        onClick={step === "choose" ? onClose : () => setStep("choose")}
                        aria-label={step === "choose" ? "Close" : "Back"}
                    >
                        ✕
                    </button>
                    <strong>Add to your story</strong>
                    <span className="post-composer-topbar-spacer" />
                </div>

                {step === "choose" && (
                    <div className="story-composer-choose">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={handleFileChange}
                        />
                        <button
                            type="button"
                            className="story-composer-choice"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <span className="story-composer-choice-icon">📷</span>
                            Photo
                        </button>
                        <button type="button" className="story-composer-choice" onClick={() => setStep("text")}>
                            <span className="story-composer-choice-icon">Aa</span>
                            Text
                        </button>
                    </div>
                )}

                {step === "photo" && previewUrl && (
                    <div className="story-composer-preview" style={{ backgroundImage: `url(${previewUrl})` }}>
                        <input
                            className="story-composer-caption-input"
                            placeholder="Add a caption..."
                            value={caption}
                            onChange={(event) => setCaption(event.target.value)}
                        />
                    </div>
                )}

                {step === "text" && (
                    <>
                        <div className="story-composer-preview" style={{ background: backgroundCss(background) }}>
                            <textarea
                                className="story-composer-text-input"
                                placeholder="Type something..."
                                value={caption}
                                onChange={(event) => setCaption(event.target.value)}
                                autoFocus
                                rows={4}
                                maxLength={300}
                            />
                        </div>

                        <div className="story-composer-swatches">
                            {BACKGROUND_PRESETS.map((preset) => (
                                <button
                                    type="button"
                                    key={preset.id}
                                    className={`story-composer-swatch${background === preset.id ? " active" : ""}`}
                                    style={{ background: preset.css }}
                                    onClick={() => setBackground(preset.id)}
                                    aria-label={`Background ${preset.id}`}
                                />
                            ))}
                        </div>
                    </>
                )}

                {step !== "choose" && (
                    <div className="post-composer-bottombar">
                        <button
                            className="sync-button post-composer-submit"
                            type="button"
                            onClick={handleShare}
                            disabled={!canShare}
                        >
                            {uploading ? "Posting..." : "Share to story"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
