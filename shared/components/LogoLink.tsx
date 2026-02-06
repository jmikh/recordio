import { type ComponentProps } from 'react';
import logoFull from '@shared/assets/fulllogo.webp';
import logoDark from '@shared/assets/fulllogo-dark.webp';

interface LogoProps extends ComponentProps<'a'> {
    className?: string;
    imgClassName?: string;
    theme?: 'light' | 'dark';
}

export const LogoLink = ({ className, imgClassName, theme = 'dark', ...props }: LogoProps) => {
    const logo = theme === 'light' ? logoDark : logoFull;

    return (
        <a
            href="https://recordio.cc"
            target="_blank"
            rel="noopener noreferrer"
            className={`opacity-80 hover:opacity-100 transition-opacity duration-200 ${className || ''}`}
            {...props}
        >
            <img src={logo} alt="Recordio" className={imgClassName || "h-6"} />
        </a>
    );
};
