"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";

export function Select({
  id,
  label,
  value,
  options,
  onValueChange,
  className = "",
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        id={id}
        className={`input select-trigger ${className}`}
        aria-label={label}
        disabled={disabled}
        data-single={options.length === 1}
      >
        <span>
          {options.find((option) => option.value === value)?.label ?? value}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="product-menu select-menu"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label={label}
        >
          <Dropdown.RadioGroup value={value} onValueChange={onValueChange}>
            {options.map((option) => (
              <Dropdown.RadioItem
                key={option.value}
                value={option.value}
                className="product-item select-option"
              >
                <span>{option.label}</span>
                <Dropdown.ItemIndicator>
                  <Check size={14} aria-hidden="true" />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
