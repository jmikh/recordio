import { LuCheck, LuStar } from 'react-icons/lu';
import { LogoLink } from '@shared/components';
import { MARKETING_ORIGIN, SUPPORT_EMAIL, CHROME_EXTENSION_URL } from '@shared/types/bridge';
import { SignInForm } from './SignInForm';
import './AuthPage.css';

interface AuthPageProps {
    /** Fires once sign-in has succeeded */
    onAuthSuccess?: () => void;
    /** Context copy overrides */
    eyebrow?: string;
    title?: string;
    subtitle?: string;
}

// Both claims come from the published Free plan (landing Pricing.tsx):
// auto zooms/spotlights/silence cutting, 1080p exports, 5 active projects,
// no card. 4K exports and captions are Pro — don't claim them here.
const FACTS = ['Start free — no credit card', 'Auto zooms, spotlights & silence cutting'];

/**
 * Full-page sign-in: the auth column on the left, the marketing panel on the
 * right. Used where signing in is the only thing on offer — the gated-route
 * block in App and the screenshot editor's auth screen. In-context prompts
 * (invite, shared screenshot) still use AuthModal.
 *
 * The panel is hidden below lg, where the page is the auth column alone.
 */
export function AuthPage({
    onAuthSuccess,
    eyebrow = 'Welcome back',
    title = 'Sign in to keep recording',
    subtitle = 'Pick up where you left off — your projects are waiting.',
}: AuthPageProps) {
    return (
        <main aria-label="Sign in" className="w-full min-h-screen flex bg-surface-body">

            {/* ── Auth column ── */}
            <div className="w-full lg:w-150 shrink-0 flex flex-col justify-between gap-10 bg-surface px-6 sm:px-12 py-10">
                <LogoLink imgClassName="h-7" className="self-start" />

                <div className="w-full max-w-96 mx-auto">
                    <p className="text-eyebrow text-primary">{eyebrow}</p>
                    <h1 className="heading-1 mt-3 mb-2">{title}</h1>
                    <p className="text-sm text-text-muted mb-7">{subtitle}</p>

                    <SignInForm onSignedIn={onAuthSuccess} />

                    <div className="w-full h-px bg-border my-7" />

                    <p className="text-xs text-text-muted">
                        New here?{' '}
                        <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="text-text-highlighted hover:underline">
                            Add Recordio to Chrome
                        </a>
                        {' '}— it's free.
                    </p>
                </div>

                <p className="text-xs text-text-muted">
                    Need help?{' '}
                    <a href={`mailto:${SUPPORT_EMAIL}`} target="_blank" rel="noopener noreferrer" className="text-text-highlighted hover:underline">
                        Contact support
                    </a>
                </p>
            </div>

            {/* ── Marketing panel ── */}
            <div className="auth-panel hidden lg:flex flex-1 relative overflow-hidden flex-col justify-between py-16 pl-16">

                <div className="relative flex flex-col gap-4 max-w-140">
                    <a
                        href={`${MARKETING_ORIGIN}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="self-start flex items-center gap-2 pl-3 pr-4 py-1.5 rounded-full bg-text-on-primary/10 border border-text-on-primary/20 hover:bg-text-on-primary/15 transition-colors"
                    >
                        <span className="flex gap-0.5" aria-hidden="true">
                            {[0, 1, 2, 3, 4].map(i => (
                                <LuStar key={i} className="icon-sm fill-current text-secondary-highlighted" />
                            ))}
                        </span>
                        <span className="text-xs font-bold text-text-on-primary">5.0</span>
                        <span className="text-xs text-text-on-primary/75">on the Chrome Web Store</span>
                    </a>

                    <h2 className="auth-panel-headline text-text-on-primary font-bold">
                        The screen recorder your product{' '}
                        <span className="text-secondary-highlighted">deserves.</span>
                    </h2>

                    <p className="text-base text-text-on-primary/85 max-w-125">
                        Recordio understands the page you're recording. Zooms, spotlights and captions
                        land exactly where they should, automatically.
                    </p>
                </div>

                {/* Product shot bleeding off the right edge, facts tucked under it */}
                <div className="relative flex flex-col mt-8">
                    <div className="relative">
                        <div className="auth-panel-glow absolute left-10 -right-10 top-5 bottom-5 rounded-[40px]" aria-hidden="true" />
                        <img
                            src="/assets/images/auth-editor.webp"
                            alt="The Recordio editor: screen settings on the left, a recording framed in a MacBook Pro on the right"
                            width={1800}
                            height={667}
                            className="auth-panel-shot relative block w-215 max-w-none h-auto rounded-l-lg border border-r-0 border-text-on-primary/25"
                        />
                    </div>

                    <ul className="relative flex gap-7 mt-7 text-sm text-text-on-primary/85">
                        {FACTS.map(fact => (
                            <li key={fact} className="flex items-center gap-2">
                                <LuCheck className="icon-md text-secondary-highlighted" />
                                {fact}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </main>
    );
}
