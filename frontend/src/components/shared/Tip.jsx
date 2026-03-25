import React, { useState, useRef, useEffect } from 'react';

export function Tip({ children, text, width = 200 }) {
    const [show, setShow] = useState(false);
    const tipRef = useRef(null);
    const containerRef = useRef(null);
    const [positionStyle, setPositionStyle] = useState({});

    useEffect(() => {
        if (show && tipRef.current && containerRef.current) {
            const tipRect = tipRef.current.getBoundingClientRect();
            const containerRect = containerRef.current.getBoundingClientRect();
            const TIP_MARGIN = 6;
            const SCREEN_MARGIN = 10;

            // FIX: Check if there's enough space above; if not, render below
            const spaceAbove = containerRect.top;
            const spaceBelow = window.innerHeight - containerRect.bottom;
            const tooltipHeight = tipRect.height;

            let newStyle;
            const centerStyle = {
                left: "50%",
                transform: "translateX(-50%)",
            };

            // Prefer above if enough space, otherwise render below
            if (spaceAbove > tooltipHeight + TIP_MARGIN) {
                newStyle = {
                    bottom: "calc(100% + 6px)",
                    ...centerStyle,
                };
            } else if (spaceBelow > tooltipHeight + TIP_MARGIN) {
                newStyle = {
                    top: "calc(100% + 6px)",
                    ...centerStyle,
                };
            } else {
                // Fallback to above (original behavior)
                newStyle = {
                    bottom: "calc(100% + 6px)",
                    ...centerStyle,
                };
            }

            // Check right edge collision
            if (containerRect.left + (tipRect.width / 2) > window.innerWidth - SCREEN_MARGIN) {
                newStyle = {
                    ...newStyle,
                    left: "auto",
                    right: 0,
                    transform: "none",
                };
            }
            // Check left edge collision
            else if (containerRect.left - (tipRect.width / 2) < SCREEN_MARGIN) {
                newStyle = {
                    ...newStyle,
                    left: 0,
                    right: "auto",
                    transform: "none",
                };
            }

            setPositionStyle(newStyle);
        }
    }, [show]);

    return (
        <span
            ref={containerRef}
            style={{ position: "relative", display: "inline-block", cursor: "help" }}
            onMouseEnter={() => setShow(true)}
            onMouseLeave={() => setShow(false)}
            onTouchStart={(e) => {
                // Prevent default to avoid event conflicts on mobile
                e.preventDefault();
                e.stopPropagation();
                setShow(!show);
            }}
            onTouchEnd={() => {
                // Don't auto-hide on touch end; let user tap again to dismiss
                // This prevents the tooltip from flickering and blocking button clicks
            }}
            role="tooltip"
            aria-label={text}
        >
            {children}
            {show && (
                <div ref={tipRef} className="fadeIn" style={{
                    position: "absolute",
                    ...positionStyle,
                    background: "#0c1c2a",
                    border: "1px solid #38c0fc44",
                    borderRadius: 7,
                    padding: "7px 10px",
                    width,
                    zIndex: 9999,
                    fontSize: 8.5,
                    color: "#8ab8d0",
                    lineHeight: 1.65,
                    pointerEvents: "none",
                    boxShadow: "0 8px 32px #00000088",
                    whiteSpace: "normal"
                }}>
                    {text}
                </div>
            )}
        </span>
    );
}
