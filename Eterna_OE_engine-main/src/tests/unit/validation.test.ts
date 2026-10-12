import { validateOrderRequest } from '../../utils/validation';
import { ValidationError } from '../../utils/errors';
import { OrderType } from '../../types/order.types';
import { Keypair } from '@solana/web3.js';
import * as bs58 from 'bs58';

describe('Order Validation', () => {
  let testKeypair: Keypair;
  let walletPrivateKey: string;
  let walletKeypair: number[];

  beforeAll(() => {
    testKeypair = Keypair.generate();
    walletPrivateKey = bs58.encode(testKeypair.secretKey);
    walletKeypair = Array.from(testKeypair.secretKey);
  });

  it('should validate a valid order request with walletPrivateKey', () => {
    const request = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey,
    };

    expect(() => validateOrderRequest(request)).not.toThrow();
  });

  it('should validate a valid order request with walletKeypair', () => {
    const request = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletKeypair,
    };

    expect(() => validateOrderRequest(request)).not.toThrow();
  });

  it('should throw error if tokenIn is missing', () => {
    const request = {
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
    } as any;

    expect(() => validateOrderRequest(request)).toThrow(ValidationError);
  });

  it('should throw error if tokenOut is missing', () => {
    const request = {
      tokenIn: 'SOL',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey,
    } as any;

    expect(() => validateOrderRequest(request)).toThrow(ValidationError);
  });

  it('should throw error if tokens are the same', () => {
    const request = {
      tokenIn: 'SOL',
      tokenOut: 'SOL',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey,
    };

    expect(() => validateOrderRequest(request)).toThrow(ValidationError);
  });

  it('should throw error if amountIn is invalid', () => {
    const request = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: -100,
      orderType: OrderType.MARKET,
      walletPrivateKey,
    };

    expect(() => validateOrderRequest(request)).toThrow(ValidationError);
  });

  it('should throw error if orderType is invalid', () => {
    const request = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: 'invalid',
      walletPrivateKey,
    } as any;

    expect(() => validateOrderRequest(request)).toThrow(ValidationError);
  });

  it('should throw error if slippageTolerance is out of range', () => {
    const request = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      slippageTolerance: 1.5,
      walletPrivateKey,
    };

    expect(() => validateOrderRequest(request)).toThrow(ValidationError);
  });

  it('should accept valid slippageTolerance with wallet', () => {
    const request = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      slippageTolerance: 0.05,
      walletPrivateKey,
    };

    expect(() => validateOrderRequest(request)).not.toThrow();
  });
});
