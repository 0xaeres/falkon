import { ProviderLogo } from "@/components/ui/brand";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Provider } from "@falkon/contracts";
import { providers } from "../lib/wizard-content";

export function ConnectStep({
  provider,
  host,
  token,
  error,
  onProvider,
  onHost,
  onToken,
}: {
  provider: Provider;
  host: string;
  token: string;
  error: string;
  onProvider: (id: Provider) => void;
  onHost: (value: string) => void;
  onToken: (value: string) => void;
}) {
  return (
    <FieldGroup>
      <RadioGroup
        aria-label="Code host"
        value={provider}
        onValueChange={(value) => onProvider(value as Provider)}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {providers.map((item) => (
          <FieldLabel
            key={item.id}
            htmlFor={`provider-${item.id}`}
            className="has-data-[state=checked]:border-foreground/50 has-data-[state=checked]:bg-accent/40"
          >
            <Field orientation="horizontal" className="items-center">
              <ProviderLogo provider={item.id} size={18} />
              <FieldContent>
                <FieldTitle>{item.name}</FieldTitle>
                <FieldDescription className="text-xs">
                  {item.description}
                </FieldDescription>
              </FieldContent>
              <RadioGroupItem value={item.id} id={`provider-${item.id}`} />
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
      <Field>
        <FieldLabel htmlFor="server-url">Server URL</FieldLabel>
        <Input
          id="server-url"
          autoFocus
          type="url"
          required
          value={host}
          placeholder="https://github.example.com"
          onChange={(event) => onHost(event.target.value)}
        />
      </Field>
      <Field data-invalid={!!error || undefined}>
        <FieldLabel htmlFor="token">Personal access token</FieldLabel>
        <Input
          id="token"
          type="password"
          autoComplete="off"
          value={token}
          aria-invalid={!!error}
          aria-describedby="token-help"
          onChange={(event) => {
            onToken(event.target.value);
          }}
        />
        <FieldDescription id="token-help">
          Read-only access is enough. Falkon stores the token encrypted.
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}
