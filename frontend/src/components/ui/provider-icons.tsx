interface ProviderIconProps {
  className?: string;
}

export function GoogleIcon({ className }: ProviderIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M21.6 12.23c0-.68-.06-1.34-.18-1.96H12v3.7h5.39a4.6 4.6 0 0 1-1.99 3.02v2.5h3.22c1.89-1.74 2.98-4.3 2.98-7.26Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.22-2.5c-.9.6-2.04.96-3.4.96-2.62 0-4.84-1.77-5.63-4.14H3.04v2.58A9.99 9.99 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.37 13.9A6.02 6.02 0 0 1 6.05 12c0-.66.11-1.31.32-1.9V7.52H3.04A10 10 0 0 0 2 12c0 1.61.38 3.13 1.04 4.48l3.33-2.58Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.97c1.47 0 2.8.5 3.84 1.48l2.88-2.88C16.95 2.9 14.7 2 12 2 8.09 2 4.72 4.24 3.04 7.52l3.33 2.58C7.16 7.73 9.38 5.97 12 5.97Z"
        fill="#EA4335"
      />
    </svg>
  );
}