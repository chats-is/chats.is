import { memo } from 'react';
import ReactMarkdown, { type Options } from 'react-markdown';

const MemoizedReactMarkdown = memo(
  (props: Options) => <ReactMarkdown {...props} />,
  (prevProps, nextProps) => prevProps.children === nextProps.children
);
MemoizedReactMarkdown.displayName = 'MemoizedReactMarkdown';

export { MemoizedReactMarkdown };
