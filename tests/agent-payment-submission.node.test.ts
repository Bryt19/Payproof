test("a Phantom Compute Budget pair is accepted when within the approved fee limit", async () => {
  const merchant = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();

  // A valid Phantom pair: SetComputeUnitPrice (9 bytes) then
  // SetComputeUnitLimit (5 bytes), both before the System transfer.
  const priceData = concat([
    Uint8Array.of(3),
    Uint8Array.from(getU64Encoder().encode(1000n)),
  ]);
  const limitData = (() => {
    const d = new Uint8Array(5);
    d[0] = 2;
    new DataView(d.buffer, d.byteOffset, d.byteLength).setUint32(
      1,
      200_000,
      true,
    );
    return d;
  })();

  const wire = wireTransaction({
    numRequiredSignatures: 1,
    numReadonlyUnsigned: 2,
    accountKeys: [
      merchant.address,
      recipient.address,
      SYSTEM_PROGRAM_ADDRESS,
      COMPUTE_BUDGET_PROGRAM,
    ],
    blockhash: BLOCKHASH,
    instructions: [
      { programIndex: 3, accountIndices: [], data: priceData },
      { programIndex: 3, accountIndices: [], data: limitData },
      { programIndex: 2, accountIndices: [0, 1], data: getTransferSolInstructionData(1_000_000_000n) },
    ],
  });

  const result = await verifyAgentTransferOnChain({
    expected: {
      signature: getBase58Decoder().decode(getBase64Encoder().encode(wire)),
      merchantWallet: merchant.address,
      recipientAddress: recipient.address,
      amountLamports: "1000000000",
    },
    lookup: lookupFor(wire, { metaAvailable: true }),
    approvedFeeLimitLamports: 10_000n,
  });

  assert.equal(result.status, "verified");
  assert.equal(result.payerAddress, merchant.address);
  assert.equal(result.commitment, "confirmed");
});

test("a priority fee inside the approved ceiling is accepted", async () => {
  const merchant = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();

  // price=1000 lamports, limit=200_000 units => ceil(1000 * 200_000 / 1_000_000) = 200 lamports
  const priceData = concat([
    Uint8Array.of(3),
    Uint8Array.from(getU64Encoder().encode(1000n)),
  ]);
  const limitData = (() => {
    const d = new Uint8Array(5);
    d[0] = 2;
    new DataView(d.buffer, d.byteOffset, d.byteLength).setUint32(
      1,
      200_000,
      true,
    );
    return d;
  })();

  const wire = wireTransaction({
    numRequiredSignatures: 1,
    numReadonlyUnsigned: 2,
    accountKeys: [
      merchant.address,
      recipient.address,
      SYSTEM_PROGRAM_ADDRESS,
      COMPUTE_BUDGET_PROGRAM,
    ],
    blockhash: BLOCKHASH,
    instructions: [
      { programIndex: 3, accountIndices: [], data: priceData },
      { programIndex: 3, accountIndices: [], data: limitData },
      { programIndex: 2, accountIndices: [0, 1], data: getTransferSolInstructionData(1_000_000_000n) },
    ],
  });

  const result = await verifyAgentTransferOnChain({
    expected: {
      signature: getBase58Decoder().decode(getBase64Encoder().encode(wire)),
      merchantWallet: merchant.address,
      recipientAddress: recipient.address,
      amountLamports: "1000000000",
    },
    lookup: lookupFor(wire, { metaAvailable: true }),
    approvedFeeLimitLamports: 500n,
  });

  assert.equal(result.status, "verified");
});

test("a priority fee above the approved ceiling is rejected", async () => {
  const merchant = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();

  const priceData = concat([
    Uint8Array.of(3),
    Uint8Array.from(getU64Encoder().encode(1000n)),
  ]);
  const limitData = (() => {
    const d = new Uint8Array(5);
    d[0] = 2;
    new DataView(d.buffer, d.byteOffset, d.byteLength).setUint32(
      1,
      200_000,
      true,
    );
    return d;
  })();

  const wire = wireTransaction({
    numRequiredSignatures: 1,
    numReadonlyUnsigned: 2,
    accountKeys: [
      merchant.address,
      recipient.address,
      SYSTEM_PROGRAM_ADDRESS,
      COMPUTE_BUDGET_PROGRAM,
    ],
    blockhash: BLOCKHASH,
    instructions: [
      { programIndex: 3, accountIndices: [], data: priceData },
      { programIndex: 3, accountIndices: [], data: limitData },
      { programIndex: 2, accountIndices: [0, 1], data: getTransferSolInstructionData(1_000_000_000n) },
    ],
  });

  const result = await verifyAgentTransferOnChain({
    expected: {
      signature: getBase58Decoder().decode(getBase64Encoder().encode(wire)),
      merchantWallet: merchant.address,
      recipientAddress: recipient.address,
      amountLamports: "1000000000",
    },
    lookup: lookupFor(wire, { metaAvailable: true }),
    approvedFeeLimitLamports: 100n,
  });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.reason, "payment_mismatch");
  }
});

test("a SetComputeUnitLimit alone is rejected", async () => {
  const merchant = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();

  const limitData = (() => {
    const d = new Uint8Array(5);
    d[0] = 2;
    new DataView(d.buffer, d.byteOffset, d.byteLength).setUint32(
      1,
      200_000,
      true,
    );
    return d;
  })();

  const wire = wireTransaction({
    numRequiredSignatures: 1,
    numReadonlyUnsigned: 2,
    accountKeys: [
      merchant.address,
      recipient.address,
      SYSTEM_PROGRAM_ADDRESS,
      COMPUTE_BUDGET_PROGRAM,
    ],
    blockhash: BLOCKHASH,
    instructions: [
      { programIndex: 3, accountIndices: [], data: limitData },
      { programIndex: 2, accountIndices: [0, 1], data: getTransferSolInstructionData(1_000_000_000n) },
    ],
  });

  const result = await verifyAgentTransferOnChain({
    expected: {
      signature: getBase58Decoder().decode(getBase64Encoder().encode(wire)),
      merchantWallet: merchant.address,
      recipientAddress: recipient.address,
      amountLamports: "1000000000",
    },
    lookup: lookupFor(wire, { metaAvailable: true }),
    approvedFeeLimitLamports: 500n,
  });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.reason, "payment_mismatch");
  }
});

test("duplicate Compute Budget instructions are rejected", async () => {
  const merchant = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();

  const priceData = concat([
    Uint8Array.of(3),
    Uint8Array.from(getU64Encoder().encode(500n)),
  ]);
  const limitData = (() => {
    const d = new Uint8Array(5);
    d[0] = 2;
    new DataView(d.buffer, d.byteOffset, d.byteLength).setUint32(
      1,
      200_000,
      true,
    );
    return d;
  })();

  const wire = wireTransaction({
    numRequiredSignatures: 1,
    numReadonlyUnsigned: 2,
    accountKeys: [
      merchant.address,
      recipient.address,
      SYSTEM_PROGRAM_ADDRESS,
      COMPUTE_BUDGET_PROGRAM,
    ],
    blockhash: BLOCKHASH,
    instructions: [
      { programIndex: 3, accountIndices: [], data: priceData },
      { programIndex: 3, accountIndices: [], data: priceData },
      { programIndex: 3, accountIndices: [], data: limitData },
      { programIndex: 3, accountIndices: [], data: limitData },
      { programIndex: 2, accountIndices: [0, 1], data: getTransferSolInstructionData(1_000_000_000n) },
    ],
  });

  const result = await verifyAgentTransferOnChain({
    expected: {
      signature: getBase58Decoder().decode(getBase64Encoder().encode(wire)),
      merchantWallet: merchant.address,
      recipientAddress: recipient.address,
      amountLamports: "1000000000",
    },
    lookup: lookupFor(wire, { metaAvailable: true }),
  });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.reason, "payment_mismatch");
  }
});

test("a malformed Compute Budget instruction is rejected", async () => {
  const merchant = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();

  // Truncated price data: 8 bytes instead of 9.
  const truncatedPrice = new Uint8Array(8);
  truncatedPrice[0] = 3;
  truncatedPrice.set(new Uint8Array(7).fill(0x42), 1);

  const wire = wireTransaction({
    numRequiredSignatures: 1,
    numReadonlyUnsigned: 2,
    a
