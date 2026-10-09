import Icon from "./Icon";

/** Each trip member gets a stable colour from their position in the list. */
export function toneOf(index: number): string {
  return `tone-${(Math.max(0, index) % 6) + 1}`;
}

export function Avatar({ name, index, small }: { name: string; index: number; small?: boolean }) {
  return (
    <span className={`avatar ${toneOf(index)}${small ? " small" : ""}`} aria-hidden="true">
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

/** Toggle chip for picking people; the dot shows a check when selected. */
export function PersonChip({
  name,
  index,
  on,
  onClick,
}: {
  name: string;
  index: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`chip person ${toneOf(index)}${on ? " on" : ""}`} aria-pressed={on} onClick={onClick}>
      <span className="dot">{on ? <Icon name="check" size={12} /> : name.trim()[0]?.toUpperCase()}</span>
      {name}
    </button>
  );
}
