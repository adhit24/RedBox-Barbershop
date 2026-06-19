import { Fraunces, Bricolage_Grotesque, Manrope, JetBrains_Mono } from 'next/font/google';
import './tokens.css';

const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata = {
  title: 'Redbox · Signage',
  description: 'In-store digital signage for Redbox Barbershop.',
};

export default function SignageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`signage-root ${fraunces.variable} ${bricolage.variable} ${manrope.variable} ${jetbrains.variable}`}
      style={{ minHeight: '100dvh' }}
    >
      {children}
    </div>
  );
}
