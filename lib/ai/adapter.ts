import { type DrawTurnRequest, type DrawStreamEvent } from "@/lib/draw/protocol";

export type DrawModelTurnInput = DrawTurnRequest;

export interface DrawModelAdapter {
  readonly name: string;
  isConfigured(): boolean;
  streamTurn(input: DrawModelTurnInput): AsyncIterable<DrawStreamEvent>;
}
