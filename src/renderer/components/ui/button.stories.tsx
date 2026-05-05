/**
 * Button Stories
 *
 * All variants and sizes of the Button primitive.
 * Use these as your starting reference when applying new Figma designs.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';
import { Loader2, Plus, Trash2 } from 'lucide-react';

const meta: Meta<typeof Button> = {
  title: 'UI Primitives/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
    },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

// ─── Individual variant stories ───────────────────────────────────────────────

export const Default: Story = {
  args: { children: 'Default Button' },
};

export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Delete' },
};

export const Outline: Story = {
  args: { variant: 'outline', children: 'Outline' },
};

export const Secondary: Story = {
  args: { variant: 'secondary', children: 'Secondary' },
};

export const Ghost: Story = {
  args: { variant: 'ghost', children: 'Ghost' },
};

export const Link: Story = {
  args: { variant: 'link', children: 'Link Button' },
};

export const Disabled: Story = {
  args: { children: 'Disabled', disabled: true },
};

export const WithLeadingIcon: Story = {
  args: { children: (<><Plus className="w-4 h-4 mr-2" />New Item</>) as React.ReactNode },
};

export const Loading: Story = {
  args: {
    disabled: true,
    children: (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading…</>) as React.ReactNode,
  },
};

export const SmallSize: Story = {
  args: { size: 'sm', children: 'Small' },
};

export const LargeSize: Story = {
  args: { size: 'lg', children: 'Large' },
};

export const IconOnly: Story = {
  args: { size: 'icon', variant: 'outline', children: (<Trash2 className="w-4 h-4" />) as React.ReactNode },
};

// ─── All variants at a glance ─────────────────────────────────────────────────

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4 items-center">
      <Button variant="default">Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4 items-center">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" variant="outline"><Plus className="w-4 h-4" /></Button>
    </div>
  ),
};
