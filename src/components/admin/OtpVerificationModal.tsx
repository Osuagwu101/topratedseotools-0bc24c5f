/**
 * OTP/2FA Verification Modal
 *
 * Displayed when a one-click login requires admin verification of an OTP code.
 * Admin enters the code received from the service, system submits it to the
 * paused browser session, and captures authenticated state for reuse.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  Clock,
  Lock,
  Loader2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  submitOtpForBrowserSession,
  getOtpSessionStatus,
  cancelOtpSession,
} from "@/lib/browser-auth-otp.functions";

interface OtpVerificationModalProps {
  open: boolean;
  sessionId: string;
  otpType: string;
  message: string;
  expiresAt: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
  onCancel?: () => void;
}

export function OtpVerificationModal({
  open,
  sessionId,
  otpType,
  message,
  expiresAt,
  onSuccess,
  onError,
  onCancel,
}: OtpVerificationModalProps) {
  const [otpCode, setOtpCode] = useState("");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  // Polling for status updates
  const { data: statusData } = useQuery({
    queryKey: ["otp-status", sessionId],
    queryFn: async () => {
      const result = await getOtpSessionStatus({ data: { session_id: sessionId } });
      return result;
    },
    enabled: open && sessionId !== "",
    refetchInterval: 2000,
    staleTime: 1000,
  });

  // Submit OTP code
  const submitMutation = useMutation({
    mutationFn: async (code: string) => {
      return await submitOtpForBrowserSession({
        data: { session_id: sessionId, otp_code: code },
      });
    },
    onSuccess: (result) => {
      toast.success("OTP verified! Capturing authenticated session…");
      setOtpCode("");
      setLastError(null);
      if (onSuccess) {
        setTimeout(() => onSuccess(), 1000);
      }
    },
    onError: (error) => {
      const errorMsg = error instanceof Error ? error.message : "Failed to verify OTP. Please try again.";
      setLastError(errorMsg);
      toast.error(errorMsg);
      if (onError) onError(errorMsg);
    },
  });

  // Cancel OTP session
  const cancelMutation = useMutation({
    mutationFn: async () => {
      return await cancelOtpSession({ data: { session_id: sessionId } });
    },
    onSuccess: () => {
      toast.info("OTP verification cancelled");
      setOtpCode("");
      if (onCancel) onCancel();
    },
  });

  // Update countdown timer
  useEffect(() => {
    if (!open || !expiresAt) return;

    const updateTimer = () => {
      const now = Date.now();
      const expiry = new Date(expiresAt).getTime();
      const remaining = Math.max(0, expiry - now);
      setTimeRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [open, expiresAt]);

  // Handle timeout
  useEffect(() => {
    if (timeRemaining === 0 && open && statusData?.timed_out) {
      toast.error("OTP verification timeout. Session closed.");
      if (onCancel) onCancel();
    }
  }, [timeRemaining, open, statusData?.timed_out, onCancel]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const isLoading = submitMutation.isPending || cancelMutation.isPending;
  const isExpired = timeRemaining === 0;
  const isValid = otpCode.trim().length > 0 && otpCode.trim().length <= 20;

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-amber-600" />
            Verify One-Time Code
          </DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* OTP Type Display */}
          <div className="rounded-lg bg-muted p-4">
            <p className="text-sm text-muted-foreground">Verification Method</p>
            <p className="mt-1 text-sm font-medium capitalize">{otpType}</p>
            {otpType === "email" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Check your email for the verification code
              </p>
            )}
            {otpType === "sms" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Check your SMS messages for the verification code
              </p>
            )}
            {otpType === "authenticator" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Enter the code from your authenticator app
              </p>
            )}
            {otpType === "security_question" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Answer the security question or enter recovery code
              </p>
            )}
          </div>

          {/* Code Input */}
          <div className="space-y-2">
            <label htmlFor="otp-code" className="text-sm font-medium">
              Enter Code
            </label>
            <input
              id="otp-code"
              type="text"
              inputMode="numeric"
              placeholder="000000"
              maxLength={20}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.toUpperCase())}
              disabled={isLoading || isExpired}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono tracking-widest placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground">
              Enter numbers, letters, or dashes as shown
            </p>
          </div>

          {/* Timer and Status */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Time remaining</span>
              <div className="flex items-center gap-1">
                <Clock className={`h-4 w-4 ${isExpired ? "text-destructive" : "text-amber-600"}`} />
                <span className={`font-mono font-medium ${isExpired ? "text-destructive" : ""}`}>
                  {formatTime(timeRemaining)}
                </span>
              </div>
            </div>

            {/* Status Message */}
            {statusData && (
              <div className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
                <p>Session Status: <span className="capitalize font-medium">{statusData.status}</span></p>
                {statusData.error && (
                  <p className="mt-1 flex items-start gap-1 text-destructive">
                    <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                    {statusData.error}
                  </p>
                )}
              </div>
            )}

            {lastError && !isExpired && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Verification Failed</p>
                  <p className="text-xs mt-1">{lastError}</p>
                </div>
              </div>
            )}

            {isExpired && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Session Expired</p>
                  <p className="text-xs mt-1">The OTP window has closed. Please try launching again.</p>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => cancelMutation.mutate()}
              disabled={isLoading || isExpired}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => submitMutation.mutate(otpCode)}
              disabled={!isValid || isLoading || isExpired}
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Verify
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
