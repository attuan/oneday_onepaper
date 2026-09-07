// 読了判定(仕様 6)

export interface CompletionState {
  chars: number;
  required: number;
  completed: boolean;
  remaining: number;
}

export function judgeCompletion(chars: number, minChars: number, alreadyCompleted: boolean): CompletionState {
  // 一度成立したら取り消さない
  const completed = alreadyCompleted || chars >= minChars;
  return { chars, required: minChars, completed, remaining: Math.max(0, minChars - chars) };
}
