export interface error_code_help {
  meaning: string;
  next_step: string;
}

const code_help: Record<string, error_code_help> = {
  "B-A001": {
    meaning: "The app could not authenticate a request to its local backend.",
    next_step: "Restart Lanshare. If the problem continues, reinstall or update the app.",
  },
  "B-P003": {
    meaning: "The receiving device declined the transfer.",
    next_step: "Ask the recipient to accept the transfer before trying again.",
  },
  "B-P004": {
    meaning: "The recipient did not respond before the request expired.",
    next_step: "Make sure the recipient is available, then send the files again.",
  },
  "B-P006": {
    meaning: "The receiving device already has as many pending transfer requests as it allows.",
    next_step: "Wait for a pending request to finish, then try again.",
  },
  "B-P007": {
    meaning: "This transfer contains more files than the receiver allows in one request.",
    next_step: "Send fewer files at a time.",
  },
  "B-P009": {
    meaning: "The receiver is temporarily limiting transfer requests.",
    next_step: "Wait a short time before trying again.",
  },
  "B-R011": {
    meaning: "The receiver rejected a file path that could escape the selected download folder.",
    next_step: "Check the file or folder names and try sending the files again.",
  },
  "B-R016": {
    meaning: "The received file did not match its expected checksum and may be corrupted.",
    next_step: "Send the file again. If it happens repeatedly, check the source file and network connection.",
  },
  "B-R021": {
    meaning: "The transfer approval was missing, invalid, or expired.",
    next_step: "Start the transfer again so the receiver can approve a fresh request.",
  },
  "B-R022": {
    meaning: "The files received did not match the files approved by the recipient.",
    next_step: "Start the transfer again and approve the new request.",
  },
  "B-R023": {
    meaning: "The sender's certificate did not match the device approved for this transfer.",
    next_step: "Do not retry until you have verified the sender and confirmed both devices are trusted correctly.",
  },
  "B-R026": {
    meaning: "The receiver could not resume the saved transfer data.",
    next_step: "Retry the transfer. Lanshare may need to send the affected file from the beginning.",
  },
  "B-R027": {
    meaning: "The saved partial file changed while the transfer was being prepared.",
    next_step: "Retry the transfer so Lanshare can prepare it again.",
  },
  "B-R030": {
    meaning: "The receiving device could not continue the transfer, often because it was cancelled or lacked disk space.",
    next_step: "Check the transfer details and available disk space, then retry if appropriate.",
  },
  "B-S010": {
    meaning: "The selected download folder is not available or cannot be used.",
    next_step: "Choose an existing folder that Lanshare can write to.",
  },
  "B-T010": {
    meaning: "Lanshare could not complete the outgoing transfer with the recipient.",
    next_step: "Make sure both devices are online on the same local network, then retry. Check the transfer details for more information.",
  },
  "B-T011": {
    meaning: "The outgoing transfer was cancelled.",
    next_step: "No action is needed unless you want to send the files again.",
  },
  "B-T012": {
    meaning: "The recipient cancelled the transfer.",
    next_step: "Ask the recipient before sending the files again.",
  },
};

const family_help: Record<string, error_code_help> = {
  "B-A": {
    meaning: "The local backend rejected an app request.",
    next_step: "Restart Lanshare. If the problem continues, update the app and try again.",
  },
  "B-C": {
    meaning: "Lanshare could not cancel the requested transfer.",
    next_step: "Check whether the transfer is still active, then try again.",
  },
  "B-CR": {
    meaning: "Lanshare could not cancel the incoming transfer.",
    next_step: "Check whether the incoming transfer is still active, then try again.",
  },
  "B-P": {
    meaning: "The receiver could not prepare or approve the transfer request.",
    next_step: "Check the transfer details and ask the recipient to try again.",
  },
  "B-R": {
    meaning: "The receiving device could not validate or save the transfer.",
    next_step: "Check the transfer details, download-folder permissions, and available disk space before retrying.",
  },
  "B-RP": {
    meaning: "Lanshare could not process the recipient's response to a transfer request.",
    next_step: "Make sure the request is still pending, then try again.",
  },
  "B-S": {
    meaning: "Lanshare could not read or save the requested settings.",
    next_step: "Check the setting and try again. Restart the app if the problem continues.",
  },
  "B-T": {
    meaning: "Lanshare could not start or complete the outgoing transfer.",
    next_step: "Check that both devices are online on the same local network, then try again.",
  },
  "B-TR": {
    meaning: "Lanshare could not update the trusted-device list.",
    next_step: "Make sure the device is visible and try again.",
  },
};

export const get_error_code_help = (
  code: string,
): error_code_help => {
  const exact_help = code_help[code];
  if (exact_help) return exact_help;

  const family = Object.keys(family_help)
    .sort((left, right) => right.length - left.length)
    .find((prefix) => code.startsWith(prefix));
  return family
    ? family_help[family]!
    : {
        meaning: "Lanshare encountered an error while handling this request.",
        next_step: "Check the error details. If the problem persists, restart the app and include the code when reporting it.",
      };
};
