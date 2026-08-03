export default function ContributionIcon({ size = 18, className = '', title = 'Contribution' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role="img"
      aria-label={title}
    >
      <path d="M12 2.5 20 7v10l-8 4.5L4 17V7Z" />
      <path d="m12 6 4.5 2.5v5L12 16l-4.5-2.5v-5Z" opacity="0.55" />
      <path d="M12 2.5V6M20 7l-3.5 1.5M20 17l-3.5-3.5M12 21.5V16M4 17l3.5-3.5M4 7l3.5 1.5" />
      <circle cx="12" cy="11" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
