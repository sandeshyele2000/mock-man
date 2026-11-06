// Created by Sandesh
import { useCallback, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

type SelectOption = { value: string; label: string };

export function SelectField({
  value,
  onValueChange,
  options,
  id,
  placeholder,
  emptyOptionLabel,
  className,
  "aria-describedby": ariaDescribedBy,
  "aria-labelledby": ariaLabelledBy,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  placeholder?: string;
  emptyOptionLabel?: string;
  className?: string;
  "aria-describedby"?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const setTriggerRef = useCallback((trigger: HTMLButtonElement | null) => {
    setPortalContainer(trigger?.closest("dialog") ?? null);
  }, []);

  return (
    <Select.Root
      value={value || (emptyOptionLabel ? "__select_none__" : undefined)}
      onValueChange={(nextValue) =>
        onValueChange(nextValue === "__select_none__" ? "" : nextValue)
      }
    >
      <Select.Trigger
        ref={setTriggerRef}
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        className={`select-trigger ${className || ""}`}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal container={portalContainer ?? undefined}>
        <Select.Content
          className="select-content"
          position="popper"
          sideOffset={5}
        >
          <Select.Viewport>
            {emptyOptionLabel && (
              <Select.Item className="select-item" value="__select_none__">
                <Select.ItemText>{emptyOptionLabel}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            )}
            {options.map((option) => (
              <Select.Item
                className="select-item"
                key={option.value}
                value={option.value}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
