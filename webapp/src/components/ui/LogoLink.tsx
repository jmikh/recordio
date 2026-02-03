import { type ComponentProps } from 'react';
import logoFull from '../../assets/fulllogo.png';

interface LogoProps extends ComponentProps<'a'> {
    className?: string;
    imgClassName?: string;
}

export const LogoLink = ({ className, imgClassName, ...props }: LogoProps) => {
    return (
        <a
            href="https://recordio.site"
            target="_blank"
            rel="noopener noreferrer"
            className={`opacity-80 hover:opacity-100 transition-opacity duration-200 ${className || ''}`}
            {...props}
        >
            <img src={logoFull} alt="Recordio" className={imgClassName || "h-6"} />
        </a>
    );
};
