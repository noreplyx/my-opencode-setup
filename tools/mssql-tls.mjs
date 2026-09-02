function parseConnectionOptions(connectionString) {
  const options = new Map();
  for (const part of connectionString.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim().toLocaleLowerCase("en-US");
    const value = part.slice(separator + 1).trim().toLocaleLowerCase("en-US");
    if (key) options.set(key, [...(options.get(key) ?? []), value]);
  }
  return options;
}

export function validateMssqlTlsConnectionString(connectionString) {
  const options = parseConnectionOptions(connectionString);
  const encryptValues = options.get("encrypt") ?? [];
  const encrypt = encryptValues.at(-1);
  if (encryptValues.includes("false")) {
    throw new Error("SQL Server connections require TLS. Encrypt=false is not allowed.");
  }
  if (encrypt !== "true") {
    throw new Error("SQL Server connections require TLS. Add 'Encrypt=true' to your connection string.");
  }
  if ((options.get("trustservercertificate") ?? []).some((value) => ["true", "yes", "1"].includes(value))) {
    throw new Error("SQL Server connections require certificate verification. TrustServerCertificate=true is not allowed.");
  }
}

export { parseConnectionOptions };
