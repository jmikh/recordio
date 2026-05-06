import logoDark from '@shared/assets/fulllogo-dark.png';
import logoLight from '@shared/assets/fulllogo-light.png';
import './LogoLink.css';

interface LogoProps {
    className?: string;
    imgClassName?: string;
}

export const LogoLink = ({ className, imgClassName }: LogoProps) => {
    const imgClass = imgClassName || 'h-6';

    return (
        <div className={className || ''}>
            {/* Light theme: show light logo. Dark theme (.dark ancestor): show dark logo */}
            <img src={logoLight} alt="Recordio" className={`logo-for-light ${imgClass}`} />
            <img src={logoDark} alt="Recordio" className={`logo-for-dark ${imgClass}`} />
        </div>
    );
};
