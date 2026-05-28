export class Document {
  constructor(
    public readonly name: string,
    public readonly extension: string,
    public readonly buffer: Buffer,
    public readonly sender: string,
    public readonly createdAt: Date,
  ) {}
}
