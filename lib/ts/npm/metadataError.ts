class InvalidNpmMetadataError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidNpmMetadataError";
  }
}

export { InvalidNpmMetadataError };
