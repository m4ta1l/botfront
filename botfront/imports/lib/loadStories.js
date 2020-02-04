import shortid from 'shortid';
import uuidv4 from 'uuid/v4';

const splitBody = (lines) => {
    const header = [];
    const body = [];
    const footer = [];
    lines.forEach((line) => {
        if (line.startsWith('>')) {
            const cleanLine = line.replace(/^> */, '').trim();
            if (!body.length) header.push(cleanLine);
            else footer.push(cleanLine);
        } else if (footer.length) {
            throw new Error('a checkpoint sandwiched between other content: bad form');
        } else body.push(line);
    });
    return { header, body: body.join('\n'), footer };
};

const checkHeader = (header, fullTitle) => {
    let ancestorOf = [];
    const linkFrom = [];
    header.forEach((origin) => {
        const motherFromCheckpoint = (origin.match(/(.*)__branches/) || [])[1];
        const motherFromTitle = (fullTitle.replace(/ /g, '_').match(/(.*)__.*/) || [])[1];
        if (motherFromCheckpoint || motherFromTitle) {
            if (motherFromCheckpoint !== motherFromTitle) {
                throw new Error('branching convention not respected!');
            }
            if (ancestorOf.length) throw new Error('multiple mothers!');
            ancestorOf = motherFromCheckpoint.split('__');
        } else {
            linkFrom.push(origin);
        }
    });
    return { ancestorOf, linkFrom };
};

const checkFooter = (footer, fullTitle) => {
    let hasDescendents = false;
    let linkTo = null;
    if (!footer.length) return { hasDescendents, linkTo };
    if (footer.length > 1) {
        throw new Error('story can\'t link to more than one destination');
    }
    const branchingCheckpoint = (footer[0].match(/(.*)__branches/) || [])[1];
    if (branchingCheckpoint && branchingCheckpoint !== fullTitle.replace(/ /g, '_')) {
        throw new Error(
            `branching convention not respected! -- ${branchingCheckpoint} -- ${fullTitle.replace(
                / /g,
                '_',
            )}`,
        );
    }
    if (branchingCheckpoint) hasDescendents = true;
    else [linkTo] = footer;
    return { hasDescendents, linkTo };
};

const parseStory = (storyGroupId, fullTitle, lines) => {
    const title = (fullTitle.match(/.*__(.*)/) || [null, fullTitle])[1];
    try {
        const { header, body, footer } = splitBody(lines);
        const { ancestorOf, linkFrom } = checkHeader(header, fullTitle);
        const { hasDescendents, linkTo } = checkFooter(footer, fullTitle);
        return {
            storyGroupId,
            title,
            fullTitle,
            ancestorOf,
            linkFrom,
            hasDescendents,
            linkTo,
            body,
        };
    } catch (error) {
        return {
            storyGroupId,
            title,
            fullTitle,
            rawText: lines.join('\n'),
            error,
        };
    }
};

export const parseStoryGroup = (storyGroupId, rawText) => `\n${rawText}`
    .split('\n## ')
    .filter(s => s.trim())
    .map((s) => {
        const [fullTitle, ...lines] = s.replace(/ *<!--.*--> *\n?/gs, '').split('\n');
        return parseStory(storyGroupId, fullTitle, lines);
    });

export const parseStoryGroups = storyGroups => storyGroups.reduce(
    (acc, { _id, rawText }) => [...acc, ...parseStoryGroup(_id, rawText)],
    [],
);

const updateLinks = (inputLinks, pathsAndIds) => {
    const {
        linkTo, ancestorPath, currentPath, _id,
    } = pathsAndIds;
    let outputLinks = inputLinks;
    if (linkTo) {
        outputLinks = [
            ...outputLinks,
            {
                name: linkTo,
                path: ancestorPath,
                value: [_id],
            },
        ];
    }
    outputLinks
        .filter(l => l.path.startsWith(currentPath))
        .forEach((l, i) => {
            outputLinks[i] = { ...l, value: [_id, ...l.value] };
        });
    return outputLinks;
};

export const generateStories = (parsedStories) => {
    let output = {};
    let links = [];
    parsedStories
        .sort((a, b) => b.ancestorOf.length - a.ancestorOf.length) // sort deepest first
        .forEach((parsedStory) => {
            const {
                body,
                title,
                storyGroupId,
                hasDescendents,
                ancestorOf,
                linkTo,
                linkFrom,
            } = parsedStory;
            const ancestorPath = ancestorOf.join('__');
            const currentPath = `${ancestorPath && `${ancestorPath}__`}${title.replace(
                / /g,
                '_',
            )}`;
            const _id = ancestorOf.length
                ? shortid.generate().replace('_', '0')
                : uuidv4();

            if (!output[ancestorPath]) output[ancestorPath] = [];
            output[ancestorPath].push({
                _id,
                story: body,
                title,
                ...(!ancestorOf.length ? { storyGroupId } : {}),
                ...(hasDescendents ? { branches: output[currentPath] } : {}),
                ...(linkFrom.length ? { checkpoints: linkFrom } : {}),
            });

            links = updateLinks(links, {
                linkTo,
                ancestorPath,
                currentPath,
                _id,
            });
        });
    output = output['']; // only output root stories (with their now embedded children)
    output.forEach((story, index) => {
        if (!story.checkpoints) return;
        output[index] = {
            ...story,
            checkpoints: output[index].checkpoints.map(
                c => links.find(l => l.name === c).value,
            ),
        };
    });
    return output;
};

const injectStoryGroupIds = (existingStoryGroups, storyGroups, merge = true) => storyGroups.map((sg) => {
    const existing = existingStoryGroups.find(esg => esg.name === sg.name);
    const _id = merge && existing ? existing._id : uuidv4();
    const name = merge && existing
        ? `${sg.name} (${new Date()
            .toISOString()
            .replace('T', ' ')
            .replace('Z', '')})`
        : sg.name;
    return { ...sg, name, _id };
});
