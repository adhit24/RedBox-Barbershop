// Hand-authored inline SVGs, 1.8px stroke, round caps/joins, 24x24 viewBox —
// per design_handoff_command_center/README.md §Icons. No icon fonts, no emoji.
import type { SVGProps } from 'react';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number;
}

function Icon({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {children}
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 5-5" />
    </Icon>
  );
}

export function RepeatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M17 2l4 4-4 4" />
      <path d="M21 6H8a4 4 0 0 0-4 4v1" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M3 18h13a4 4 0 0 0 4-4v-1" />
    </Icon>
  );
}

export function AlertClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5" />
      <path d="M9 2h6" />
    </Icon>
  );
}

export function MemberIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
      <path d="M8.5 13.5 7 21l5-3 5 3-1.5-7.5" />
    </Icon>
  );
}

export function WalletClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h6" />
      <path d="M3 7V5a2 2 0 0 1 2-2h12v4" />
      <circle cx="17" cy="16" r="5" />
      <path d="M17 14v2l1.5 1" />
    </Icon>
  );
}

export function BoxIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Icon>
  );
}

export function BarChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20V10" />
      <path d="M12 20V4" />
      <path d="M20 20v-6" />
      <path d="M3 20h18" />
    </Icon>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </Icon>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M2.8 21c.2-3.6 2.9-5.6 6.2-5.6s6 2 6.2 5.6" />
      <circle cx="17.5" cy="9.5" r="2.5" />
      <path d="M15.8 21c.2-2.8 1.9-4.7 4.4-4.7" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Icon>
  );
}
