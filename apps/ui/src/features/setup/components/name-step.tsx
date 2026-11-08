import { Check } from "lucide-react";
import { ProviderLogo } from "@/components/ui/brand";
import { Badge } from "@/components/ui/badge";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import type { Provider } from "@falkon/contracts";

export function NameStep({
  name,
  id,
  available,
  provider,
  connectionHost,
  onName,
}: {
  name: string;
  id: string;
  available: boolean;
  provider: Provider;
  connectionHost?: string;
  onName: (value: string) => void;
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="product-name">Product name</FieldLabel>
        <Input
          id="product-name"
          autoFocus
          placeholder="Payments Platform"
          required
          maxLength={80}
          value={name}
          onChange={(event) => {
            onName(event.target.value);
          }}
        />
      </Field>
      <Field data-invalid={(!!id && !available) || undefined}>
        <FieldLabel htmlFor="product-id">productId</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="product-id"
            className="font-mono"
            value={id}
            readOnly
            aria-invalid={!!id && !available}
          />
          <InputGroupAddon align="inline-end">
            <Badge variant={id ? (available ? "success" : "danger") : "muted"}>
              {id
                ? available
                  ? "Available"
                  : "Already in use"
                : "Enter a name"}
            </Badge>
          </InputGroupAddon>
        </InputGroup>
        <FieldDescription>
          Used in API calls and by coding agents. It can’t be changed after
          setup.
        </FieldDescription>
      </Field>
      <Field>
        <FieldTitle>Connected as</FieldTitle>
        <div className="flex items-center gap-3 rounded-md border bg-secondary/40 px-3 py-2.5">
          <ProviderLogo provider={provider} size={14} />
          <span className="flex-1 text-[0.8125rem] text-muted-foreground">
            Token connection on{" "}
            <strong className="font-medium text-foreground">
              {connectionHost}
            </strong>
          </span>
          <Badge variant="success">
            <Check />
            Connected
          </Badge>
        </div>
      </Field>
    </FieldGroup>
  );
}
