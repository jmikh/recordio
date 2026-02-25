import { type ComponentProps } from 'react';
import logoDark from '@shared/assets/fulllogo-dark.png';
import logoLight from '@shared/assets/fulllogo-light.png';
import './LogoLink.css';

interface LogoProps extends ComponentProps<'a'> {
    className?: string;
    imgClassName?: string;
}

export const LogoLink = ({ className, imgClassName, ...props }: LogoProps) => {
    const imgClass = imgClassName || 'h-6';

    return (
        <a
            href="/"
            className={`opacity-90 hover:opacity-100 transition-opacity duration-200 ${className || ''}`}
            {...props}
        >
            {/* Light theme: show light logo. Dark theme (.dark ancestor): show dark logo */}
            <img src={logoLight} alt="Recordio" className={`logo-for-light ${imgClass}`} />
            <img src={logoDark} alt="Recordio" className={`logo-for-dark ${imgClass}`} />
        </a>
    );
};
