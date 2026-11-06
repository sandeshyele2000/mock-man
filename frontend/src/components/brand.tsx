// Created by Sandesh
export function MockmanMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4.5 18V6l7.5 7 7.5-7v12"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="4.5" cy="5.5" r="1.5" fill="currentColor" />
      <circle cx="19.5" cy="5.5" r="1.5" fill="currentColor" />
    </svg>
  );
}
