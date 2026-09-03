export type OpenRoomIconName =
  | "cart"
  | "check"
  | "close"
  | "move"
  | "reset"
  | "rotate"
  | "select"
  | "sparkles"
  | "undo";

interface OpenRoomIconProps {
  name: OpenRoomIconName;
  size?: number;
}

export function OpenRoomIcon({ name, size = 18 }: OpenRoomIconProps) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
  };

  return (
    <svg
      aria-hidden="true"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...common}
    >
      {name === "cart" ? (
        <>
          <path d="M3.5 5h2l1.7 9.2h9.9l2-6.3H6.2" />
          <circle cx="9" cy="18.5" r="1" />
          <circle cx="16.5" cy="18.5" r="1" />
        </>
      ) : null}
      {name === "check" ? <path d="m5 12.5 4.2 4.2L19 7" /> : null}
      {name === "close" ? (
        <>
          <path d="m6 6 12 12" />
          <path d="M18 6 6 18" />
        </>
      ) : null}
      {name === "move" ? (
        <>
          <path d="M12 3v18M3 12h18" />
          <path d="m8.5 6.5 3.5-3.5 3.5 3.5M8.5 17.5 12 21l3.5-3.5M6.5 8.5 3 12l3.5 3.5M17.5 8.5 21 12l-3.5 3.5" />
        </>
      ) : null}
      {name === "reset" ? (
        <>
          <path d="M4.5 8.5V4m0 0H9" />
          <path d="M5 5.2A8 8 0 1 1 4.4 17" />
        </>
      ) : null}
      {name === "rotate" ? (
        <>
          <path d="M19.5 8.5V4m0 0H15" />
          <path d="M19 5.2a8 8 0 1 0 .6 11.8" />
        </>
      ) : null}
      {name === "select" ? (
        <path d="m6 3 11 9-5.4 1.1L9 19Z" />
      ) : null}
      {name === "sparkles" ? (
        <>
          <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2Z" />
          <path d="m18.5 13 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z" />
          <path d="m5.5 14 .7 2.3 2.3.7-2.3.7L5.5 20l-.7-2.3-2.3-.7 2.3-.7Z" />
        </>
      ) : null}
      {name === "undo" ? (
        <>
          <path d="m8 8-4 4 4 4" />
          <path d="M5 12h8.5a5.5 5.5 0 0 1 5.5 5.5" />
        </>
      ) : null}
    </svg>
  );
}
