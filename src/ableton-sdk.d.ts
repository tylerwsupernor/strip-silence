declare module "@ableton-extensions/sdk" {
  // Minimal types to satisfy this project's imports for local builds.
  // Signatures mirror the real SDK (vendor/ableton-extensions-sdk dist .d.mts).
  export type ArrangementSelection = {
    selected_lanes: any[];
    time_selection_start: number;
    time_selection_end: number;
  };

  export type ActivationContext = unknown;

  export class DataModelObject {
    // base class for data model objects
  }

  export class AudioTrack<TVersion extends string = string> extends DataModelObject {
    name: string;
    clearClipsInRange(start: number, end: number): Promise<void>;
  }

  export interface Resources {
    renderPreFxAudio(track: AudioTrack, startTime: number, endTime: number): Promise<string>;
  }

  export interface Ui {
    registerContextMenuAction(scope: string, label: string, commandId: string): unknown;
    showModalDialog(url: string, width: number, height: number): Promise<string>;
    withinProgressDialog(
      text: string,
      options: { progress?: number },
      callback: (
        update: (updateText: string, progress?: number) => Promise<void>,
        abortSignal: AbortSignal,
      ) => Promise<unknown>,
    ): Promise<unknown>;
  }

  export interface ExtensionContext {
    commands: {
      registerCommand(id: string, cb: (arg: unknown) => unknown): unknown;
    };
    resources: Resources;
    ui: Ui;
    getObjectFromHandle<T extends DataModelObject>(
      handle: unknown,
      type: abstract new (...args: never[]) => T,
    ): T;
    withinTransaction<T>(fn: () => T): T;
  }

  export function initialize(activation: ActivationContext, apiVersion: string): ExtensionContext;
}

