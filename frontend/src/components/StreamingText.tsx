import { Box, Typography, LinearProgress } from "@mui/material";
import { useEffect, useRef } from "react";

interface Props {
  text: string;
  streaming: boolean;
  placeholder?: string;
  sx?: object;
}

export function StreamingText({ text, streaming, placeholder, sx }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [text]);

  return (
    <Box sx={{ position: "relative", ...sx }}>
      {streaming && (
        <LinearProgress
          sx={{ position: "absolute", top: 0, left: 0, right: 0, borderRadius: "4px 4px 0 0" }}
        />
      )}
      <Box
        ref={ref}
        sx={{
          mt: streaming ? 0.5 : 0,
          maxHeight: 320,
          overflowY: "auto",
          p: 2,
          bgcolor: "grey.50",
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
          minHeight: 80,
        }}
      >
        {text ? (
          <Typography
            variant="body2"
            sx={{
              whiteSpace: "pre-wrap",
              lineHeight: 1.7,
              fontFamily: "inherit",
            }}
          >
            {text}
            {streaming && (
              <Box
                component="span"
                sx={{
                  display: "inline-block",
                  width: 8,
                  height: 14,
                  bgcolor: "primary.main",
                  ml: 0.25,
                  verticalAlign: "text-bottom",
                  animation: "blink 1s step-end infinite",
                  "@keyframes blink": {
                    "0%, 100%": { opacity: 1 },
                    "50%": { opacity: 0 },
                  },
                }}
              />
            )}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.disabled" sx={{ fontStyle: "italic" }}>
            {streaming ? "Generating…" : placeholder ?? "Nothing yet."}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
