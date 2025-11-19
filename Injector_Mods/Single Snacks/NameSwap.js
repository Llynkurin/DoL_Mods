// "Original Name": "New Name",
const nameSwaps = {
    "Bailey": "Chicken Foot",
    "Robin": "Biggie"
};

$(document).on(':passagedisplay', function (event) {
    const passageContent = event.content;

    const namesToFind = Object.keys(nameSwaps);

    if (namesToFind.length === 0) {
        return;
    }
    const regex = new RegExp('\\b(' + namesToFind.join('|') + ')\\b', 'g');

    const textNodes = $(passageContent).find('*').addBack().contents().filter(function () {
        return this.nodeType === 3;
    });

    textNodes.each(function () {
        const originalText = this.nodeValue;
        const newText = originalText.replace(regex, function (matchedName) {
            return nameSwaps[matchedName];
        });

        if (originalText !== newText) {
            this.nodeValue = newText;
        }
    });
});